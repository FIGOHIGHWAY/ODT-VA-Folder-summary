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

/** Run the ZAP-VM pin helper (`set|add <ip> <host>` or `clear`). */
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

/**
 * Service check for the tool-status panel: does ZAP's API answer, and which
 * version. (The VM's disk/RAM/CPU come from the resource monitor.)
 * @returns {Promise<{ version: string|null, apiError: string|null }>}
 */
export async function getZapHealth() {
	try {
		const { version } = await zapGet('/JSON/core/view/version/', {}, 8000);
		return { version: version ?? null, apiError: null };
	} catch (e) {
		return { version: null, apiError: errText(e) };
	}
}

function errText(e) {
	return e instanceof Error ? e.message : String(e);
}

/** Raw host stats (DISK/MEM/CPUUSEC/NCPU lines) from the ZAP VM's pin helper. */
export function zapHostStats() {
	return runPin('stats');
}

/** The VM ZAP runs on (its API is reached through a local tunnel). */
export function zapVmHost() {
	return env.ZAP_PIN_SSH_HOST || null;
}

async function zapGet(path, params = {}, timeoutMs = 0) {
	const { baseUrl, apiKey } = config();
	const url = new URL(path, baseUrl);
	url.searchParams.set('apikey', apiKey);
	for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
	const res = await fetch(url, timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : undefined);
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

// Active-scan rules turned off for every scan: 40026 Cross Site Scripting
// (DOM Based), 10104 User Agent Fuzzer.
const DISABLED_SCANNER_IDS = ['40026', '10104'];

// How many target URLs are spidered + active-scanned at the same time inside
// one ZAP session. ZAP runs concurrent scans fine; the real limit is the
// container's RAM, so this is capped and overridable via env. Default 5.
const DEFAULT_CONCURRENCY = 5;
const MAX_CONCURRENCY = 10;

function scanConcurrency() {
	const raw = Number.parseInt(env.ZAP_SCAN_CONCURRENCY ?? '', 10);
	if (!Number.isFinite(raw) || raw < 1) return DEFAULT_CONCURRENCY;
	return Math.min(raw, MAX_CONCURRENCY);
}

/**
 * Roll each target's per-phase percent (spider 0–100, active scan 0–100) into
 * one 0–100 figure — spider is the first half, active scan the second — and
 * recompute the job's aggregate percent, phase label and "done X/N" progress
 * across every concurrent target.
 * @param {object} job
 */
function recompute(job) {
	const trs = [...job.targets.values()];
	if (trs.length === 0) return;
	job.percent = Math.round(trs.reduce((s, t) => s + (t.percent || 0), 0) / trs.length);
	const done = trs.filter((t) => t.done).length;
	// A representative coarse phase for the status label: show the latest stage
	// any target has reached that isn't finished yet.
	if (trs.some((t) => !t.done && t.phase === 'active-scan')) job.phase = 'active-scan';
	else if (trs.some((t) => !t.done && t.phase === 'spider')) job.phase = 'spider';
	else job.phase = 'fetching-alerts';
	job.progress = trs.length > 1 ? `เสร็จ ${done}/${trs.length} เว็บ` : '';
}

/**
 * Poll one spider/active-scan to completion, updating that target's slice of
 * the aggregate progress. `kind` maps the raw percent into this target's half
 * (spider → 0–50, active scan → 50–100).
 * @param {object} job
 * @param {{ percent: number, done: boolean }} tr per-target tracker
 * @param {'spider'|'ascan'} kind
 */
async function waitForCompletion(statusPath, scanId, job, tr, kind) {
	let lastPercent = -1;
	let stalledFor = 0;
	for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
		if (job.cancelled) throw new Error('ยกเลิกโดยผู้ใช้');
		const { status } = await zapGet(statusPath, { scanId });
		const raw = Number(status);
		tr.percent = kind === 'spider' ? Math.round(raw / 2) : 50 + Math.round(raw / 2);
		recompute(job);
		if (raw >= 100) return;

		stalledFor = raw > lastPercent ? 0 : stalledFor + 1;
		lastPercent = raw;
		if (stalledFor >= STALL_LIMIT) {
			throw new Error(
				`${statusPath} ค้างที่ ${raw}% มานาน ${(STALL_LIMIT * POLL_INTERVAL_MS) / 60000} นาทีโดยไม่ขยับ — ถือว่าสแกนติดค้าง`
			);
		}
		await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
	}
	throw new Error(`${statusPath} ไม่เสร็จภายในเวลาที่กำหนด (เกิน ${(MAX_ATTEMPTS * POLL_INTERVAL_MS) / 3600000} ชั่วโมง)`);
}

/**
 * Spider then active-scan one target to completion inside the shared session,
 * returning its alerts. Errors are scoped to this target by the caller so one
 * bad URL doesn't sink the rest of the batch.
 * @param {object} job
 * @param {string} targetUrl
 * @returns {Promise<object[]>}
 */
async function scanOneTarget(job, targetUrl) {
	const tr = job.targets.get(targetUrl);

	tr.phase = 'spider';
	const { scan: spiderId } = await zapGet('/JSON/spider/action/scan/', { url: targetUrl });
	tr.scanType = 'spider';
	tr.scanId = spiderId;
	await waitForCompletion('/JSON/spider/view/status/', spiderId, job, tr, 'spider');

	tr.phase = 'active-scan';
	let ascanId;
	try {
		({ scan: ascanId } = await zapGet('/JSON/ascan/action/scan/', { url: targetUrl }));
	} catch (err) {
		// ZAP replies URL_NOT_FOUND when the spider found no page to scan at this
		// target — almost always a mistyped URL or a host ZAP can't reach.
		if (/URL_NOT_FOUND/i.test(err instanceof Error ? err.message : String(err))) {
			throw new Error(
				`ZAP spider ไม่พบหน้าใดในเป้าหมาย "${targetUrl}" จึงเริ่ม active scan ไม่ได้ — ตรวจสอบว่า URL ถูกต้อง (เช่น .ac.th ครบ) และเข้าถึงได้`
			);
		}
		throw err;
	}
	// A valid scan id is numeric; anything else (e.g. an error placeholder) would
	// later surface as a cryptic "does_not_exist" when polling status.
	if (ascanId == null || !/^\d+$/.test(String(ascanId))) {
		throw new Error(
			`ZAP ไม่คืนรหัส active scan ที่ใช้ได้สำหรับ "${targetUrl}" — spider อาจไม่พบหน้าใด ตรวจสอบ URL/การเข้าถึง`
		);
	}
	tr.scanType = 'ascan';
	tr.scanId = ascanId;
	await waitForCompletion('/JSON/ascan/view/status/', ascanId, job, tr, 'ascan');

	tr.phase = 'fetching-alerts';
	const { alerts } = await zapGet('/JSON/core/view/alerts/', { baseurl: targetUrl });
	tr.done = true;
	tr.percent = 100;
	recompute(job);
	return alerts;
}

/**
 * Run up to `concurrency` targets at once with a worker pool, collecting every
 * target's alerts and keeping any per-target failures separate.
 * @param {object} job
 * @param {string[]} urlList
 * @param {number} concurrency
 * @returns {Promise<{ allAlerts: object[], errors: string[] }>}
 */
async function runTargetPool(job, urlList, concurrency) {
	const allAlerts = [];
	const errors = [];
	let next = 0;
	async function worker() {
		for (;;) {
			if (job.cancelled) return;
			const i = next++;
			if (i >= urlList.length) return;
			const url = urlList[i];
			try {
				allAlerts.push(...(await scanOneTarget(job, url)));
			} catch (err) {
				const tr = job.targets.get(url);
				if (tr) {
					tr.error = err instanceof Error ? err.message : String(err);
					tr.done = true;
					tr.percent = 100;
				}
				errors.push(`${url}: ${err instanceof Error ? err.message : String(err)}`);
				recompute(job);
			}
		}
	}
	await Promise.all(Array.from({ length: Math.min(concurrency, urlList.length) }, worker));
	return { allAlerts, errors };
}

/** The hostname of a URL, or null if it can't be parsed. */
function hostnameOf(url) {
	try {
		return new URL(url).hostname.toLowerCase();
	} catch {
		return null;
	}
}

/**
 * Launch a Spider crawl followed by an Active Scan against one or more
 * target URLs, then fetch the resulting alerts. Runs in the background; poll
 * with getScanStatus(jobId).
 * Targets are spidered + active-scanned concurrently (a worker pool, default 5,
 * `ZAP_SCAN_CONCURRENCY` to change) inside one shared ZAP session.
 * @param {string[]} urlList target URLs (already validated by the caller)
 * @param {{ host: string, ip: string }[]} pins DNS pins: each host is forced to
 *   resolve to its IP for the scan (hosts-file style), so a specific server
 *   behind a shared name is scanned while findings keep the clean hostname.
 *   Every pinned host must be the host of at least one target URL.
 * @param {(jobId: string, outcome: { alerts: object[]|null, error: string|null }) => Promise<{ ok: boolean, result?: object, error?: string }>} onFinish
 *   persists the outcome; the job stays "running" (phase "importing") until it resolves
 * @returns {string} jobId
 */
export function startScan(urlList, pins, onFinish) {
	if (urlList.length === 0) {
		throw new Error('ต้องระบุ URL อย่างน้อย 1 รายการ');
	}
	const targetHosts = new Set(urlList.map(hostnameOf).filter(Boolean));
	const strayPin = pins.find((p) => !targetHosts.has(p.host));
	if (strayPin) {
		throw new Error(`ปัก DNS ให้ ${strayPin.host} แต่ไม่มี URL ของชื่อนี้ในรายการเป้าหมาย`);
	}

	// Each scan starts a fresh ZAP session (see below), which would wipe a
	// concurrent scan's data — so only one ZAP scan may run at a time.
	if ([...jobs.values()].some((j) => j.status === 'running')) {
		throw new Error('มี ZAP scan กำลังทำงานอยู่ — รอให้เสร็จหรือยกเลิกก่อน แล้วค่อยสั่งใหม่');
	}

	const jobId = randomUUID();
	// One tracker per target so concurrent scans each keep their own phase,
	// percent and the ZAP scan ids needed to stop them on cancel.
	const targets = new Map(
		urlList.map((url) => [
			url,
			{ phase: 'spider', percent: 0, done: false, error: null, scanType: null, scanId: null }
		])
	);
	jobs.set(jobId, {
		status: 'running',
		phase: 'spider',
		progress: '',
		percent: 0,
		alerts: null,
		error: null,
		cancelled: false,
		targets
	});

	(async () => {
		const job = jobs.get(jobId);
		try {
			// Force each pinned hostname to resolve to its chosen IP for the
			// duration of this scan (cleared in the finally below), so ZAP hits the
			// intended server while sending the real hostname (correct SNI, Host
			// and URLs). Clear first so a pin left by a crashed run can't linger.
			if (pins.length > 0) {
				await runPin('clear');
				for (const { host, ip } of pins) {
					await runPin(`add ${ip} ${host}`);
				}
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
			// Rules that cost far more than they find. DOM XSS renders pages in
			// Firefox, which on sites with a Cloudflare challenge retries the
			// unreachable challenge host until ZAP nears its memory cap (it took
			// ZAP down once). User Agent Fuzzer only reports info-level variants
			// and made up two thirds of a kkuenterprise scan's findings.
			await zapGet('/JSON/ascan/action/disableScanners/', { ids: DISABLED_SCANNER_IDS.join(',') });

			// Skip noise that is never a vulnerability but explodes the result set:
			// Next.js build assets (/_next/…) and the image optimizer's per-size,
			// per-quality URL variants (…&w=256&q=75), which turn one image into
			// dozens of URLs. One kkuenterprise scan produced ~15k findings this
			// way. Re-added every run because newSession above clears the excludes.
			for (const regex of EXCLUDE_REGEXES) {
				await zapGet('/JSON/spider/action/excludeFromScan/', { regex });
				await zapGet('/JSON/ascan/action/excludeFromScan/', { regex });
			}

			// Scan every target concurrently (a pool, so a long URL list doesn't
			// swamp ZAP's memory all at once). Per-target failures are collected
			// rather than thrown so one bad URL doesn't waste the rest of the batch.
			const { allAlerts, errors } = await runTargetPool(job, urlList, scanConcurrency());

			if (job.cancelled) throw new Error('ยกเลิกโดยผู้ใช้');
			// Only fail the whole job when nothing could be scanned; otherwise keep
			// the alerts we did get and note which targets failed.
			if (allAlerts.length === 0 && errors.length > 0) {
				throw new Error(errors.join(' | '));
			}
			if (errors.length > 0) {
				console.warn(`[zap ${jobId}] ${errors.length} เป้าหมายล้มเหลว: ${errors.join(' | ')}`);
			}
			job.alerts = allAlerts;
		} catch (err) {
			job.error = err instanceof Error ? err.message : String(err);
		} finally {
			// Always remove the DNS pins so they never leak into a later scan and
			// make the hostnames resolve normally again.
			if (pins.length > 0) {
				await runPin('clear').catch(() => {});
			}
			// Drop this scan's request/response history now that the alerts are in
			// memory. ZAP stores it on disk in the session; one large scan grew it
			// to 45 GB, filled the VM's disk and took ZAP down (2026-11-23).
			await zapGet('/JSON/core/action/newSession/', { name: '', overwrite: 'true' }).catch(() => {});
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
 * Per-target progress of a running job, for showing each URL's own bar
 * when several sites scan concurrently. Never consumes the job's result.
 * @param {string} jobId
 * @returns {{ url: string, phase: string, percent: number, done: boolean, error: string|null }[]|null}
 */
export function peekTargets(jobId) {
	const job = jobs.get(jobId);
	if (!job || job.status !== 'running') return null;
	return [...job.targets.entries()].map(([url, tr]) => ({
		url,
		phase: tr.phase,
		percent: tr.percent || 0,
		done: tr.done,
		error: tr.error
	}));
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
	// Stop every target's currently-running spider/active-scan.
	for (const tr of job.targets.values()) {
		if (tr.scanType && tr.scanId != null && !tr.done) {
			await zapGet(`/JSON/${tr.scanType}/action/stop/`, { scanId: tr.scanId }).catch(() => {});
		}
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
