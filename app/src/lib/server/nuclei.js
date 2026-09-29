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

/**
 * Launch a Nuclei scan against a target by running the CLI over SSH on its
 * VM (Nuclei has no HTTP API of its own) and streaming JSONL results back.
 * Runs in the background; poll with getScanStatus(jobId).
 * @param {string} target
 * @returns {string} jobId
 */
export function startScan(target) {
	const { host, user, keyPath } = config();
	const jobId = randomUUID();
	jobs.set(jobId, { status: 'running', output: '', error: '' });

	const remoteCmd = `nuclei -u ${shellQuote(target)} -jsonl -silent`;
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
