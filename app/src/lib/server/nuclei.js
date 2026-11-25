import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { env } from '$env/dynamic/private';

/**
 * @typedef {{ hostHeader: string|null, targets: string[] }} NucleiGroup
 * @typedef {{ hostHeader: string|null, output: string }} NucleiGroupOutput
 */

/** @type {Map<string, any>} */
const jobs = new Map();

function config() {
	const host = env.NUCLEI_SSH_HOST;
	const user = env.NUCLEI_SSH_USER;
	const keyPath = env.NUCLEI_SSH_KEY_PATH;
	if (!host || !user || !keyPath) {
		throw new Error('ยังไม่ได้ตั้งค่า NUCLEI_SSH_HOST / NUCLEI_SSH_USER / NUCLEI_SSH_KEY_PATH');
	}
	return { host, user, keyPath };
}

const CVE_ID_PATTERN = /^CVE-\d{4}-\d{4,}$/i;

/**
 * Build the remote nuclei command for one group of targets.
 * @param {NucleiGroup} group
 * @param {string|null} cveId
 */
function buildRemoteCmd(group, cveId) {
	const targetArgs = group.targets.map((t) => `-u ${shellQuote(t)}`).join(' ');
	// -stats-json makes nuclei print a JSON progress line (with "percent")
	// to stderr every -si seconds, alongside the -jsonl results on stdout.
	const statsArgs = '-stats -stats-json -si 5';
	// -duc disables the per-run template update check: the Nuclei VM can't
	// finish downloading the template zip from GitHub (it times out), and
	// without this every scan stalls on that failed update first.
	// -H sends a fixed Host header so an IP target is scanned as a named vhost.
	const hostArg = group.hostHeader ? ` -H ${shellQuote(`Host: ${group.hostHeader}`)}` : '';
	const baseArgs = `-jsonl -silent -duc ${statsArgs}${hostArg}`;
	return cveId
		? `nuclei ${targetArgs} -id ${shellQuote(cveId.toUpperCase())} ${baseArgs}`
		: `nuclei ${targetArgs} ${baseArgs}`;
}

/**
 * Run one group's nuclei over SSH to completion.
 * @returns {Promise<{ output: string, error: string|null }>}
 */
function runGroup(job, group, cveId, groupIndex, groupCount) {
	const { host, user, keyPath } = config();
	return new Promise((resolve) => {
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
				buildRemoteCmd(group, cveId)
			],
			{ stdio: ['ignore', 'pipe', 'pipe'] }
		);
		job.process = ssh;

		let output = '';
		let errText = '';
		let stderrBuffer = '';
		ssh.stdout.on('data', (chunk) => {
			output += chunk.toString('utf-8');
		});
		ssh.stderr.on('data', (chunk) => {
			stderrBuffer += chunk.toString('utf-8');
			const lines = stderrBuffer.split('\n');
			stderrBuffer = lines.pop() ?? '';
			for (const line of lines) {
				const percent = statsPercent(line);
				if (percent !== null) {
					// Each group is an equal slice of the job's overall progress.
					job.percent = Math.round((groupIndex * 100 + percent) / groupCount);
				} else if (line.trim()) {
					errText += `${line}\n`;
				}
			}
		});

		let settled = false;
		const done = (error) => {
			if (settled) return;
			settled = true;
			job.process = null;
			resolve({ output, error });
		};
		ssh.on('close', (code) => done(code === 0 ? null : errText.trim() || `nuclei exited with code ${code}`));
		ssh.on('error', (err) => done(err.message));
	});
}

/** The progress percent from a nuclei -stats-json line, or null for any other line. */
function statsPercent(line) {
	const trimmed = line.trim();
	if (!trimmed.startsWith('{')) return null;
	try {
		const percent = Number(JSON.parse(trimmed).percent);
		return Number.isFinite(percent) ? percent : null;
	} catch {
		return null;
	}
}

/**
 * Launch a Nuclei scan by running the CLI over SSH on its VM (Nuclei has no
 * HTTP API of its own) and collecting JSONL results. Runs in the background;
 * poll with getScanStatus(jobId).
 *
 * Targets come in groups that share a Host header, since nuclei's -H applies
 * to a whole run: each group is one nuclei run, executed one after another.
 * A group's Host header makes nuclei hit its targets at their IP while
 * sending that hostname, so the right virtual host is scanned.
 * @param {NucleiGroup[]} groups
 * @param {string|null} cveId when given, only the template matching this CVE
 *   is run (nuclei-templates names CVE templates after the CVE itself)
 *   instead of the full default template set.
 * @param {(jobId: string, outcome: { outputs: NucleiGroupOutput[], error: string|null }) => Promise<{ ok: boolean, result?: object, error?: string }>} onFinish
 *   persists the outcome; the job stays "running" until it resolves
 * @returns {string} jobId
 */
export function startScan(groups, cveId, onFinish) {
	config(); // fail fast on missing settings, before a job is created
	if (cveId && !CVE_ID_PATTERN.test(cveId)) {
		throw new Error(`รูปแบบ CVE ID ไม่ถูกต้อง: "${cveId}" (ต้องเป็นรูปแบบ CVE-YYYY-NNNN)`);
	}
	const nonEmpty = groups.filter((g) => g.targets.length > 0);
	if (nonEmpty.length === 0) {
		throw new Error('ต้องระบุ target อย่างน้อย 1 รายการ');
	}

	const jobId = randomUUID();
	const job = { status: 'running', error: '', percent: null, process: null, cancelled: false, result: null };
	jobs.set(jobId, job);

	(async () => {
		/** @type {NucleiGroupOutput[]} */
		const outputs = [];
		const errors = [];
		for (let i = 0; i < nonEmpty.length; i++) {
			if (job.cancelled) break;
			const group = nonEmpty[i];
			const { output, error } = await runGroup(job, group, cveId, i, nonEmpty.length);
			if (job.cancelled) break;
			if (error) {
				const label = group.hostHeader ? `Host: ${group.hostHeader}` : group.targets.join(', ');
				errors.push(nonEmpty.length > 1 ? `[${label}] ${error}` : error);
			} else {
				outputs.push({ hostHeader: group.hostHeader, output });
			}
		}

		// Fail the job only when cancelled or when no group succeeded; otherwise
		// import what we got and log the groups that failed.
		let error = null;
		if (job.cancelled) error = 'ยกเลิกโดยผู้ใช้';
		else if (outputs.length === 0) error = errors.join('\n') || 'nuclei ไม่คืนผลลัพธ์';
		else if (errors.length > 0) console.warn(`[nuclei ${jobId}] ${errors.length} กลุ่มล้มเหลว: ${errors.join(' | ')}`);

		const outcome = await onFinish(jobId, { outputs: error ? [] : outputs, error });
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
 * Health snapshot for the tool-status panel: nuclei's version and the VM's
 * disk/RAM, in one SSH round trip. Lines are prefixed (VER/DISK/CPU/MEM) so
 * the shared parser in toolStatus.js can read them.
 * @returns {Promise<string>} raw prefixed output
 */
export function getNucleiHealth() {
	const { host, user, keyPath } = config();
	const remote = [
		`echo "VER $(nuclei -version 2>&1 | grep -oiE 'v[0-9]+\\.[0-9]+\\.[0-9]+' | head -1)"`,
		'echo "DISK $(df -P / | tail -1)"',
		'echo "CPU $(nproc)"',
		'echo "MEM $(free -m | sed -n 2p)"'
	].join('; ');
	return new Promise((resolve, reject) => {
		const ssh = spawn(
			'ssh',
			['-i', keyPath, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=6', `${user}@${host}`, remote],
			{ stdio: ['ignore', 'pipe', 'pipe'] }
		);
		let out = '';
		let err = '';
		const timer = setTimeout(() => ssh.kill(), 10000);
		ssh.stdout.on('data', (d) => (out += d.toString('utf-8')));
		ssh.stderr.on('data', (d) => (err += d.toString('utf-8')));
		ssh.on('close', (code) => {
			clearTimeout(timer);
			code === 0 ? resolve(out) : reject(new Error((err || `ssh exited with code ${code}`).trim().slice(0, 200)));
		});
		ssh.on('error', (e) => {
			clearTimeout(timer);
			reject(e);
		});
	});
}

/** The VM nuclei runs on. */
export function nucleiVmHost() {
	return env.NUCLEI_SSH_HOST || null;
}

/** Only allow characters safe to embed unquoted-adjacent in the remote command; wrap the rest in single quotes. */
function shellQuote(str) {
	return `'${String(str).replace(/'/g, `'\\''`)}'`;
}

/**
 * @param {string} jobId
 * @returns {{ status: 'running'|'done'|'error'|'not_found', percent?: number|null, result?: object, error?: string }}
 */
export function getScanStatus(jobId) {
	const job = jobs.get(jobId);
	if (!job) return { status: 'not_found' };
	if (job.status === 'error') return { status: 'error', error: job.error };
	if (job.status === 'running') return { status: 'running', percent: job.percent };
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
 * Cancel a running scan by killing the local SSH client process — closing
 * the connection makes the remote nuclei process's stdout pipe break,
 * which ends it too — and skipping any groups not started yet.
 * @param {string} jobId
 * @returns {boolean} whether a running job was found and cancelled
 */
export function cancelScan(jobId) {
	const job = jobs.get(jobId);
	if (!job || job.status !== 'running') return false;
	job.cancelled = true;
	job.process?.kill();
	job.status = 'error';
	job.error = 'ยกเลิกโดยผู้ใช้';
	return true;
}
