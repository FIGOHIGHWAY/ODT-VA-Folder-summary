import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { env } from '$env/dynamic/private';

/** @type {Map<string, { status: 'running'|'done'|'error', output: string, error: string }>} */
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

/** Splits a free-text target field (comma or newline separated) into a clean list. */
function splitTargets(targets) {
	return String(targets)
		.split(/[\n,]+/)
		.map((t) => t.trim())
		.filter(Boolean);
}

/**
 * Launch a Nuclei scan against one or more targets by running the CLI over
 * SSH on its VM (Nuclei has no HTTP API of its own) and streaming JSONL
 * results back. Runs in the background; poll with getScanStatus(jobId).
 * @param {string} targets one target, or several separated by commas/newlines
 * @param {string|null} [cveId] when given, only the template matching this
 *   CVE is run (nuclei-templates names CVE templates after the CVE itself)
 *   instead of the full default template set.
 * @param {(jobId: string, outcome: { output: string, error: string|null }) => Promise<{ ok: boolean, result?: object, error?: string }>} onFinish
 *   persists the outcome; the job stays "running" until it resolves
 * @returns {string} jobId
 */
export function startScan(targets, cveId, onFinish) {
	const { host, user, keyPath } = config();
	if (cveId && !CVE_ID_PATTERN.test(cveId)) {
		throw new Error(`รูปแบบ CVE ID ไม่ถูกต้อง: "${cveId}" (ต้องเป็นรูปแบบ CVE-YYYY-NNNN)`);
	}
	const targetList = splitTargets(targets);
	if (targetList.length === 0) {
		throw new Error('ต้องระบุ target อย่างน้อย 1 รายการ');
	}
	const jobId = randomUUID();
	jobs.set(jobId, { status: 'running', output: '', error: '', percent: null, process: null });

	// -stats-json makes nuclei print a JSON progress line (with "percent")
	// to stderr every -si seconds, alongside the -jsonl results on stdout.
	const targetArgs = targetList.map((t) => `-u ${shellQuote(t)}`).join(' ');
	const statsArgs = '-stats -stats-json -si 5';
	// -duc disables the per-run template update check: the Nuclei VM can't
	// finish downloading the template zip from GitHub (it times out), and
	// without this every scan stalls on that failed update first.
	const baseArgs = `-jsonl -silent -duc ${statsArgs}`;
	const remoteCmd = cveId
		? `nuclei ${targetArgs} -id ${shellQuote(cveId.toUpperCase())} ${baseArgs}`
		: `nuclei ${targetArgs} ${baseArgs}`;
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
			remoteCmd
		],
		{ stdio: ['ignore', 'pipe', 'pipe'] }
	);

	const job = jobs.get(jobId);
	job.process = ssh;
	ssh.stdout.on('data', (chunk) => {
		job.output += chunk.toString('utf-8');
	});
	let stderrBuffer = '';
	ssh.stderr.on('data', (chunk) => {
		stderrBuffer += chunk.toString('utf-8');
		const lines = stderrBuffer.split('\n');
		stderrBuffer = lines.pop() ?? '';
		for (const line of lines) handleStderrLine(job, line);
	});
	let settled = false;
	async function settle(error) {
		if (settled) return;
		settled = true;
		const outcome = await onFinish(jobId, { output: job.output, error });
		job.output = '';
		job.process = null;
		if (outcome.ok) {
			job.result = outcome.result;
			job.status = 'done';
		} else {
			job.error = outcome.error;
			job.status = 'error';
		}
	}
	ssh.on('close', (code) => {
		const failed = code !== 0 || job.status === 'error';
		settle(failed ? job.error.trim() || `nuclei exited with code ${code}` : null);
	});
	ssh.on('error', (err) => settle(err.message));

	return jobId;
}

/** Routes a stderr line to the job's progress if it's a stats line, else to its error text. */
function handleStderrLine(job, line) {
	const trimmed = line.trim();
	if (!trimmed) return;
	if (trimmed.startsWith('{')) {
		try {
			const stats = JSON.parse(trimmed);
			const percent = Number(stats.percent);
			if (Number.isFinite(percent)) {
				job.percent = percent;
				return;
			}
		} catch {
			// not a stats line — fall through and keep it as error text
		}
	}
	job.error += `${line}\n`;
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
 * which ends it too.
 * @param {string} jobId
 * @returns {boolean} whether a running job was found and cancelled
 */
export function cancelScan(jobId) {
	const job = jobs.get(jobId);
	if (!job || job.status !== 'running') return false;
	job.process?.kill();
	job.status = 'error';
	job.error = 'ยกเลิกโดยผู้ใช้';
	return true;
}
