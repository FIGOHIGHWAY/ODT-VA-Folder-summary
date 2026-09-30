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
 * @returns {string} jobId
 */
export function startScan(targets, cveId = null) {
	const { host, user, keyPath } = config();
	if (cveId && !CVE_ID_PATTERN.test(cveId)) {
		throw new Error(`รูปแบบ CVE ID ไม่ถูกต้อง: "${cveId}" (ต้องเป็นรูปแบบ CVE-YYYY-NNNN)`);
	}
	const targetList = splitTargets(targets);
	if (targetList.length === 0) {
		throw new Error('ต้องระบุ target อย่างน้อย 1 รายการ');
	}
	const jobId = randomUUID();
	jobs.set(jobId, { status: 'running', output: '', error: '' });

	const targetArgs = targetList.map((t) => `-u ${shellQuote(t)}`).join(' ');
	const remoteCmd = cveId
		? `nuclei ${targetArgs} -id ${shellQuote(cveId.toUpperCase())} -jsonl -silent`
		: `nuclei ${targetArgs} -jsonl -silent`;
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
	ssh.stdout.on('data', (chunk) => {
		job.output += chunk.toString('utf-8');
	});
	ssh.stderr.on('data', (chunk) => {
		job.error += chunk.toString('utf-8');
	});
	ssh.on('close', (code) => {
		if (code === 0) {
			job.status = 'done';
		} else {
			job.status = 'error';
			if (!job.error) job.error = `nuclei exited with code ${code}`;
		}
	});
	ssh.on('error', (err) => {
		job.status = 'error';
		job.error = err.message;
	});

	return jobId;
}

/** Only allow characters safe to embed unquoted-adjacent in the remote command; wrap the rest in single quotes. */
function shellQuote(str) {
	return `'${String(str).replace(/'/g, `'\\''`)}'`;
}

/**
 * @param {string} jobId
 * @returns {{ status: 'running'|'done'|'error'|'not_found', output?: string, error?: string }}
 */
export function getScanStatus(jobId) {
	const job = jobs.get(jobId);
	if (!job) return { status: 'not_found' };
	if (job.status === 'error') return { status: 'error', error: job.error };
	if (job.status === 'running') return { status: 'running' };
	jobs.delete(jobId);
	return { status: 'done', output: job.output };
}
