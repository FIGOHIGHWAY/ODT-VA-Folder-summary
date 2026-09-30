import { randomUUID } from 'node:crypto';
import { env } from '$env/dynamic/private';

/** @type {Map<string, { status: 'running'|'done'|'error', phase: string, alerts: object|null, error: string|null }>} */
const jobs = new Map();

function config() {
	const host = env.ZAP_API_HOST;
	const port = env.ZAP_API_PORT;
	const apiKey = env.ZAP_API_KEY;
	if (!host || !port || !apiKey) {
		throw new Error('ยังไม่ได้ตั้งค่า ZAP_API_HOST / ZAP_API_PORT / ZAP_API_KEY');
	}
	return { baseUrl: `http://${host}:${port}`, apiKey };
}

async function zapGet(path, params = {}) {
	const { baseUrl, apiKey } = config();
	const url = new URL(path, baseUrl);
	url.searchParams.set('apikey', apiKey);
	for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
	const res = await fetch(url);
	if (!res.ok) {
		const body = await res.text().catch(() => '');
		throw new Error(`ZAP API ${path} failed: ${res.status} ${body.slice(0, 300)}`);
	}
	return res.json();
}

async function waitForCompletion(statusPath, scanId) {
	for (let attempt = 0; attempt < 180; attempt++) {
		const { status } = await zapGet(statusPath, { scanId });
		if (Number(status) >= 100) return;
		await new Promise((r) => setTimeout(r, 5000));
	}
	throw new Error(`${statusPath} ไม่เสร็จภายในเวลาที่กำหนด`);
}

/** Splits a free-text target field (comma or newline separated) into a clean list. */
function splitTargets(targets) {
	return String(targets)
		.split(/[\n,]+/)
		.map((t) => t.trim())
		.filter(Boolean);
}

/**
 * Launch a Spider crawl followed by an Active Scan against one or more
 * target URLs (run sequentially), then fetch the resulting alerts. Runs in
 * the background; poll with getScanStatus(jobId).
 * @param {string} targetUrls one URL, or several separated by commas/newlines
 * @returns {string} jobId
 */
export function startScan(targetUrls) {
	const urlList = splitTargets(targetUrls);
	if (urlList.length === 0) {
		throw new Error('ต้องระบุ URL อย่างน้อย 1 รายการ');
	}

	const jobId = randomUUID();
	jobs.set(jobId, { status: 'running', phase: 'spider', progress: '', alerts: null, error: null });

	(async () => {
		const job = jobs.get(jobId);
		try {
			const allAlerts = [];
			for (const [i, targetUrl] of urlList.entries()) {
				job.progress = urlList.length > 1 ? `${i + 1}/${urlList.length}: ${targetUrl}` : '';

				job.phase = 'spider';
				const { scan: spiderId } = await zapGet('/JSON/spider/action/scan/', { url: targetUrl });
				await waitForCompletion('/JSON/spider/view/status/', spiderId);

				job.phase = 'active-scan';
				const { scan: ascanId } = await zapGet('/JSON/ascan/action/scan/', { url: targetUrl });
				await waitForCompletion('/JSON/ascan/view/status/', ascanId);

				job.phase = 'fetching-alerts';
				const { alerts } = await zapGet('/JSON/core/view/alerts/', { baseurl: targetUrl });
				allAlerts.push(...alerts);
			}
			job.alerts = allAlerts;
			job.status = 'done';
		} catch (err) {
			job.status = 'error';
			job.error = err instanceof Error ? err.message : String(err);
		}
	})();

	return jobId;
}

/**
 * @param {string} jobId
 * @returns {{ status: 'running'|'done'|'error'|'not_found', phase?: string, progress?: string, alerts?: object|null, error?: string }}
 */
export function getScanStatus(jobId) {
	const job = jobs.get(jobId);
	if (!job) return { status: 'not_found' };
	if (job.status === 'running') return { status: 'running', phase: job.phase, progress: job.progress };
	if (job.status === 'error') return { status: 'error', error: job.error };
	jobs.delete(jobId);
	return { status: 'done', alerts: job.alerts };
}
