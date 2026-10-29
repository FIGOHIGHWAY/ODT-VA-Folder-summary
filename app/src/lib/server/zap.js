import { spawn } from 'node:child_process';
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

// DNS pinning lets ZAP scan a vhost by its real name while forcing that name
// to resolve to a chosen IP — the "hosts file" approach. ZAP has no API for
// this, so a locked-down forced-command SSH key runs a helper on the ZAP VM
// that adds/removes one marked line in the ZAP container's /etc/hosts.
function pinConfig() {
	const host = env.ZAP_PIN_SSH_HOST;
	const user = env.ZAP_PIN_SSH_USER;
	const keyPath = env.ZAP_PIN_SSH_KEY_PATH;
	if (!host || !user || !keyPath) {
		throw new Error(
			'ยังไม่ได้ตั้งค่า ZAP_PIN_SSH_HOST / ZAP_PIN_SSH_USER / ZAP_PIN_SSH_KEY_PATH สำหรับการปัก DNS'
		);
	}
	return { host, user, keyPath };
}

/** Run the ZAP-VM pin helper (`set <ip> <host>` or `clear`). */
function runPin(command) {
	const { host, user, keyPath } = pinConfig();
	return new Promise((resolve, reject) => {
		const ssh = spawn(
			'ssh',
			[
				'-i',
				keyPath,
				'-o',
				'BatchMode=yes',
				'-o',
				'StrictHostKeyChecking=accept-new',
				'-o',
				'ConnectTimeout=10',
				`${user}@${host}`,
				command
			],
			{ stdio: ['ignore', 'pipe', 'pipe'] }
		);
		let out = '';
		let err = '';
		ssh.stdout.on('data', (d) => (out += d.toString('utf-8')));
		ssh.stderr.on('data', (d) => (err += d.toString('utf-8')));
		ssh.on('close', (code) =>
			code === 0
				? resolve(out.trim())
				: reject(new Error(`pin ล้มเหลว (exit ${code}): ${(err || out).trim().slice(0, 200)}`))
		);
		ssh.on('error', (e) => reject(e));
	});
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

// A large/slow site can legitimately take a long time to spider or scan, so
// this doesn't time out on elapsed time alone — only if progress genuinely
// stops advancing for a long stretch (a real stall), up to a generous outer
// cap so a truly stuck scan doesn't poll forever.
const POLL_INTERVAL_MS = 5000;
const STALL_LIMIT = 360; // 360 * 5s = 30 min with no progress movement
const MAX_ATTEMPTS = 4320; // 4320 * 5s = 6 hours absolute cap

// URL patterns excluded from both the spider and the active scan — static,
// non-vulnerable noise that otherwise inflates a scan by thousands of URLs.
const EXCLUDE_REGEXES = ['.*/_next/.*', '.*[?&]w=[0-9]+&q=[0-9]+.*'];

/** @param {{ percent: number, cancelled?: boolean }} job */
async function waitForCompletion(statusPath, scanId, job) {
	let lastPercent = -1;
	let stalledFor = 0;
	for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
		if (job.cancelled) throw new Error('ยกเลิกโดยผู้ใช้');
		const { status } = await zapGet(statusPath, { scanId });
		job.percent = Number(status);
		if (job.percent >= 100) return;

		stalledFor = job.percent > lastPercent ? 0 : stalledFor + 1;
		lastPercent = job.percent;
		if (stalledFor >= STALL_LIMIT) {
			throw new Error(
				`${statusPath} ค้างที่ ${job.percent}% มานาน ${(STALL_LIMIT * POLL_INTERVAL_MS) / 60000} นาทีโดยไม่ขยับ — ถือว่าสแกนติดค้าง`
			);
		}
		await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
	}
	throw new Error(`${statusPath} ไม่เสร็จภายในเวลาที่กำหนด (เกิน ${(MAX_ATTEMPTS * POLL_INTERVAL_MS) / 3600000} ชั่วโมง)`);
}

/** The hostname of a URL, or null if it can't be parsed. */
function hostnameOf(url) {
	try {
		return new URL(url).hostname.toLowerCase();
	} catch {
		return null;
	}
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
 * @param {string|null} pinIp when given, the single target hostname is forced
 *   to resolve to this IP for the scan (hosts-file style), so a specific server
 *   behind a shared name is scanned while findings keep the clean hostname.
 * @param {(jobId: string, outcome: { alerts: object[]|null, error: string|null }) => Promise<{ ok: boolean, result?: object, error?: string }>} onFinish
 *   persists the outcome; the job stays "running" (phase "importing") until it resolves
 * @returns {string} jobId
 */
export function startScan(targetUrls, pinIp, onFinish) {
	const urlList = splitTargets(targetUrls);
	if (urlList.length === 0) {
		throw new Error('ต้องระบุ URL อย่างน้อย 1 รายการ');
	}

	// When a pin IP is given, the target is scanned by its real hostname but
	// that hostname is forced to resolve to the chosen IP inside ZAP — so the
	// right server is scanned while findings carry the clean hostname. Pinning
	// rewrites one hostname→IP mapping, so it supports a single host at a time.
	let pinHost = null;
	if (pinIp) {
		const hosts = [...new Set(urlList.map(hostnameOf).filter(Boolean))];
		if (hosts.length !== 1) {
			throw new Error('การปัก DNS รองรับทีละ 1 โฮสต์ (ระบุ URL ปลายทางเพียงโฮสต์เดียว)');
		}
		pinHost = hosts[0];
	}

	// Each scan starts a fresh ZAP session (see below), which would wipe a
	// concurrent scan's data — so only one ZAP scan may run at a time.
	if ([...jobs.values()].some((j) => j.status === 'running')) {
		throw new Error('มี ZAP scan กำลังทำงานอยู่ — รอให้เสร็จหรือยกเลิกก่อน แล้วค่อยสั่งใหม่');
	}

	const jobId = randomUUID();
	jobs.set(jobId, {
		status: 'running',
		phase: 'spider',
		progress: '',
		percent: 0,
		alerts: null,
		error: null,
		cancelled: false,
		currentScanType: null,
		currentScanId: null
	});

	(async () => {
		const job = jobs.get(jobId);
		try {
			// Force the target hostname to resolve to the chosen IP for the duration
			// of this scan (cleared in the finally below), so ZAP hits the intended
			// server while sending the real hostname (correct SNI, Host and URLs).
			if (pinHost) {
				await runPin(`set ${pinIp} ${pinHost}`);
			}

			// ZAP keeps every request/response from every past scan in memory
			// for the life of the daemon; across scans that grew until the VM
			// ran out of RAM and hung. A new session discards that history.
			await zapGet('/JSON/core/action/newSession/', { name: '', overwrite: 'true' });

			// The DOM XSS rule launches one Firefox per active-scan thread; at
			// ZAP's default of 8 threads that blew through the container's memory
			// cap and killed ZAP mid-scan. 3 keeps DOM XSS checks within budget.
			// Set every scan since the option resets when the container is recreated.
			await zapGet('/JSON/ascan/action/setOptionThreadPerHost/', { Integer: '3' });
			// A single rule (seen with DOM XSS) could hang for 40+ minutes and
			// take ZAP down with it. Cap each rule so ZAP skips a stuck one and
			// carries on with the rest of the scan.
			await zapGet('/JSON/ascan/action/setOptionMaxRuleDurationInMins/', { Integer: '10' });

			// Skip noise that is never a vulnerability but explodes the result set:
			// Next.js build assets (/_next/…) and the image optimizer's per-size,
			// per-quality URL variants (…&w=256&q=75), which turn one image into
			// dozens of URLs. One kkuenterprise scan produced ~15k findings this
			// way. Re-added every run because newSession above clears the excludes.
			for (const regex of EXCLUDE_REGEXES) {
				await zapGet('/JSON/spider/action/excludeFromScan/', { regex });
				await zapGet('/JSON/ascan/action/excludeFromScan/', { regex });
			}

			const allAlerts = [];
			for (const [i, targetUrl] of urlList.entries()) {
				job.progress = urlList.length > 1 ? `${i + 1}/${urlList.length}: ${targetUrl}` : '';

				job.phase = 'spider';
				job.percent = 0;
				const { scan: spiderId } = await zapGet('/JSON/spider/action/scan/', { url: targetUrl });
				job.currentScanType = 'spider';
				job.currentScanId = spiderId;
				await waitForCompletion('/JSON/spider/view/status/', spiderId, job);

				job.phase = 'active-scan';
				job.percent = 0;
				let ascanId;
				try {
					({ scan: ascanId } = await zapGet('/JSON/ascan/action/scan/', { url: targetUrl }));
				} catch (err) {
					// ZAP replies URL_NOT_FOUND when the spider found no page to scan at
					// this target — almost always a mistyped URL or a host ZAP can't
					// reach. Surface that instead of the raw API error.
					if (/URL_NOT_FOUND/i.test(err instanceof Error ? err.message : String(err))) {
						throw new Error(
							`ZAP spider ไม่พบหน้าใดในเป้าหมาย "${targetUrl}" จึงเริ่ม active scan ไม่ได้ — ตรวจสอบว่า URL ถูกต้อง (เช่น .ac.th ครบ) และเข้าถึงได้`
						);
					}
					throw err;
				}
				// A valid scan id is numeric; anything else (e.g. an error placeholder)
				// would later surface as a cryptic "does_not_exist" when polling status.
				if (ascanId == null || !/^\d+$/.test(String(ascanId))) {
					throw new Error(
						`ZAP ไม่คืนรหัส active scan ที่ใช้ได้สำหรับ "${targetUrl}" — spider อาจไม่พบหน้าใด ตรวจสอบ URL/การเข้าถึง`
					);
				}
				job.currentScanType = 'ascan';
				job.currentScanId = ascanId;
				await waitForCompletion('/JSON/ascan/view/status/', ascanId, job);

				job.phase = 'fetching-alerts';
				job.percent = 100;
				const { alerts } = await zapGet('/JSON/core/view/alerts/', { baseurl: targetUrl });
				allAlerts.push(...alerts);
			}
			job.alerts = allAlerts;
		} catch (err) {
			job.error = err instanceof Error ? err.message : String(err);
		} finally {
			// Always remove the DNS pin so it never leaks into a later scan and
			// make the hostname resolve normally again.
			if (pinHost) {
				await runPin('clear').catch(() => {});
			}
		}

		job.phase = 'importing';
		const outcome = await onFinish(jobId, { alerts: job.alerts, error: job.error });
		job.alerts = null;
		if (outcome.ok) {
			job.result = outcome.result;
			job.status = 'done';
		} else {
			job.error = outcome.error;
			job.status = 'error';
		}
	})();

	return jobId;
}

/**
 * @param {string} jobId
 * @returns {{ status: 'running'|'done'|'error'|'not_found', phase?: string, progress?: string, percent?: number, result?: object, error?: string }}
 */
export function getScanStatus(jobId) {
	const job = jobs.get(jobId);
	if (!job) return { status: 'not_found' };
	if (job.status === 'running')
		return { status: 'running', phase: job.phase, progress: job.progress, percent: job.percent };
	if (job.status === 'error') return { status: 'error', error: job.error };
	return { status: 'done', result: job.result };
}

/**
 * Current progress percentage without consuming the job's result.
 * @param {string} jobId
 * @returns {number|null}
 */
export function peekPercent(jobId) {
	const job = jobs.get(jobId);
	return job && job.status === 'running' ? job.percent : null;
}

/**
 * Whether this server process still tracks the job. Unlike getScanStatus
 * this never consumes a finished result. A job launched before the last
 * server restart is lost from memory and can never report back.
 * @param {string} jobId
 */
export function isTracked(jobId) {
	return jobs.has(jobId);
}

/**
 * Cancel a running scan: tells ZAP to stop the current spider/active-scan
 * job and flags the tracked job so its polling loop exits immediately
 * instead of waiting for the next status check.
 * @param {string} jobId
 * @returns {Promise<boolean>} whether a running job was found and cancelled
 */
export async function cancelScan(jobId) {
	const job = jobs.get(jobId);
	if (!job || job.status !== 'running') {
		// Not tracked in memory — likely the server restarted since this scan
		// was launched. Best effort: stop everything currently running on
		// ZAP directly, since in practice only one scan runs at a time here.
		await stopAllActiveScans();
		return false;
	}
	job.cancelled = true;
	if (job.currentScanType && job.currentScanId != null) {
		const stopPath = `/JSON/${job.currentScanType}/action/stop/`;
		await zapGet(stopPath, { scanId: job.currentScanId }).catch(() => {});
	}
	return true;
}

async function stopAllActiveScans() {
	for (const type of ['spider', 'ascan']) {
		const { scans } = await zapGet(`/JSON/${type}/view/scans/`).catch(() => ({ scans: [] }));
		for (const scan of scans ?? []) {
			if (scan.state === 'RUNNING') {
				await zapGet(`/JSON/${type}/action/stop/`, { scanId: scan.id }).catch(() => {});
			}
		}
	}
}
