import https from 'node:https';
import { env } from '$env/dynamic/private';

function config() {
	const baseUrl = env.NESSUS_URL;
	const accessKey = env.NESSUS_ACCESS_KEY;
	const secretKey = env.NESSUS_SECRET_KEY;
	const pinnedFingerprint = env.NESSUS_CERT_FINGERPRINT;
	if (!baseUrl || !accessKey || !secretKey || !pinnedFingerprint) {
		throw new Error(
			'ยังไม่ได้ตั้งค่า NESSUS_URL / NESSUS_ACCESS_KEY / NESSUS_SECRET_KEY / NESSUS_CERT_FINGERPRINT'
		);
	}
	return { baseUrl, accessKey, secretKey, pinnedFingerprint };
}

/**
 * The Nessus scanner VM serves its API over a self-signed certificate, so
 * there's no CA to validate against. Instead of disabling TLS verification
 * outright (which would accept any certificate, opening the door to a
 * man-in-the-middle), this pins the connection to the exact certificate
 * fingerprint captured from the VM and refuses to talk to anything else —
 * including if the VM's certificate is later silently replaced.
 */
function pinnedRequest(path, { method = 'GET', body, headers = {} } = {}) {
	const { baseUrl, accessKey, secretKey, pinnedFingerprint } = config();
	const url = new URL(path, baseUrl);

	return new Promise((resolve, reject) => {
		const req = https.request(
			url,
			{
				method,
				rejectUnauthorized: false,
				headers: {
					'X-ApiKeys': `accessKey=${accessKey}; secretKey=${secretKey}`,
					'Content-Type': 'application/json',
					...headers
				}
			},
			(res) => {
				let data = '';
				res.on('data', (chunk) => (data += chunk));
				res.on('end', () => resolve({ status: res.statusCode ?? 0, text: data }));
			}
		);

		req.on('socket', (socket) => {
			socket.once('secureConnect', () => {
				const cert = socket.getPeerCertificate();
				if (!cert || cert.fingerprint256 !== pinnedFingerprint) {
					req.destroy(
						new Error(
							'Nessus TLS certificate ไม่ตรงกับที่ pin ไว้ — ปฏิเสธการเชื่อมต่อ (อาจเกิด MITM หรือ cert ถูกเปลี่ยน)'
						)
					);
				}
			});
		});

		req.on('error', reject);
		if (body) req.write(body);
		req.end();
	});
}

async function nessusFetch(path, opts = {}) {
	const { status, text } = await pinnedRequest(path, opts);
	if (status < 200 || status >= 300) {
		throw new Error(`Nessus API ${path} failed: ${status} ${text.slice(0, 300)}`);
	}
	return text;
}

/** Find a basic network scan template's UUID to create scans against. */
async function getBasicTemplateUuid() {
	const body = JSON.parse(await nessusFetch('/editor/scan/templates'));
	const tpl = body.templates?.find((t) => t.name === 'basic') ?? body.templates?.[0];
	if (!tpl) throw new Error('ไม่พบ scan template บน Nessus');
	return tpl.uuid;
}

/**
 * Create and immediately launch a scan against the given targets.
 * @param {string} name
 * @param {string} targets comma-separated IPs/hostnames
 * @returns {Promise<{ scanId: number }>}
 */
export async function createAndLaunchScan(name, targets) {
	const uuid = await getBasicTemplateUuid();
	const created = JSON.parse(
		await nessusFetch('/scans', {
			method: 'POST',
			body: JSON.stringify({ uuid, settings: { name, text_targets: targets } })
		})
	);
	const scanId = created.scan.id;
	await nessusFetch(`/scans/${scanId}/launch`, { method: 'POST', body: '{}' });
	return { scanId };
}

/**
 * @param {number} scanId
 * @returns {Promise<{ status: string }>}
 */
export async function getScanStatus(scanId) {
	const body = JSON.parse(await nessusFetch(`/scans/${scanId}`));
	return { status: body.info?.status ?? 'unknown' };
}

/**
 * Request an HTML export of a completed scan and wait for it to be ready,
 * then download and return the HTML content.
 * @param {number} scanId
 * @returns {Promise<string>}
 */
export async function exportScanHtml(scanId) {
	const { file } = JSON.parse(
		await nessusFetch(`/scans/${scanId}/export`, {
			method: 'POST',
			body: JSON.stringify({ format: 'html', chapters: 'vuln_hosts_summary' })
		})
	);

	for (let attempt = 0; attempt < 30; attempt++) {
		const { status } = JSON.parse(await nessusFetch(`/scans/${scanId}/export/${file}/status`));
		if (status === 'ready') break;
		await new Promise((r) => setTimeout(r, 2000));
	}

	return nessusFetch(`/scans/${scanId}/export/${file}/download`);
}
