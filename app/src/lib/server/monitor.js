/**
 * Resource monitor: every minute, read disk / RAM / CPU from each scanner VM
 * and the prod host, keep the latest sample in memory (for live views) and
 * store it in vm_metrics (for history charts, kept 30 days).
 *
 * All scanner VMs are LXC containers on Proxmox, where /proc/loadavg and
 * /proc/stat describe the whole host — so CPU is computed from each
 * container's own cgroup counter (usage_usec) between two samples.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import { env } from '$env/dynamic/private';
import { pool } from './db.js';
import { zapHostStats } from './zap.js';
import { parseHostStats, diskFromKb, memFromMb, cpuPercent } from './hostStats.js';

const INTERVAL_MS = 60_000;
const COLLECT_TIMEOUT_MS = 20_000;
const RETENTION_DAYS = 30;

// Thresholds shared by every view of this data.
export const THRESHOLDS = {
	disk: { warn: 85, crit: 95 },
	mem: { warn: 90, crit: 97 },
	cpu: { warn: 90, crit: 98 }
};
/** A VM whose last good sample is older than this is shown as offline. */
export const STALE_MS = 3 * INTERVAL_MS;

// Same one-line stats script as ~/vastat.sh, for the Nuclei VM whose key
// already runs arbitrary commands.
const VASTAT_INLINE = [
	'echo "DISK $(df -P / | tail -1)"',
	'echo "MEM $(free -m | sed -n 2p)"',
	`echo "CPUUSEC $(awk '/^usage_usec/{print $2}' /sys/fs/cgroup/cpu.stat 2>/dev/null)"`,
	'echo "NCPU $(nproc)"'
].join('; ');

/**
 * @typedef {{
 *   vm: string, at: number, ok: boolean, error: string|null,
 *   cpuPct: number|null, cpus: number|null,
 *   mem: ReturnType<typeof memFromMb>|null,
 *   disk: ReturnType<typeof diskFromKb>|null
 * }} Sample
 */

/** The machines to watch, in display order. */
export function monitorTargets() {
	const monitorKey = env.MONITOR_SSH_KEY_PATH || env.ZAP_PIN_SSH_KEY_PATH;
	const monitorUser = env.MONITOR_SSH_USER || 'phonhat';
	let nessusHost = env.NESSUS_VM_HOST || null;
	if (!nessusHost && env.NESSUS_URL) {
		try {
			nessusHost = new URL(env.NESSUS_URL).hostname;
		} catch {
			// leave null
		}
	}
	const viaVastat = (host) => () => sshRun({ host, user: monitorUser, keyPath: monitorKey, command: 'vastat' });
	const openvasHost = env.OPENVAS_VM_HOST || '10.101.118.177';
	return [
		{ id: 'prod', name: 'VA Scan (prod)', host: 'odt-stvascan', collect: collectLocal },
		{ id: 'zap', name: 'OWASP ZAP', host: env.ZAP_PIN_SSH_HOST || null, collect: () => zapHostStats() },
		{ id: 'openvas', name: 'OpenVAS', host: openvasHost, collect: viaVastat(openvasHost) },
		{
			id: 'nuclei',
			name: 'Nuclei',
			host: env.NUCLEI_SSH_HOST || null,
			collect: () =>
				sshRun({
					host: env.NUCLEI_SSH_HOST,
					user: env.NUCLEI_SSH_USER,
					keyPath: env.NUCLEI_SSH_KEY_PATH,
					command: VASTAT_INLINE
				})
		},
		{ id: 'nessus', name: 'Nessus', host: nessusHost, collect: viaVastat(nessusHost) }
	];
}

/** Run one SSH command and return its stdout. */
function sshRun({ host, user, keyPath, command }) {
	if (!host || !user || !keyPath) return Promise.reject(new Error('ยังไม่ได้ตั้งค่า SSH สำหรับเครื่องนี้'));
	return new Promise((resolve, reject) => {
		const ssh = spawn(
			'ssh',
			['-i', keyPath, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=8', `${user}@${host}`, command],
			{ stdio: ['ignore', 'pipe', 'pipe'] }
		);
		let out = '';
		let err = '';
		const timer = setTimeout(() => ssh.kill(), COLLECT_TIMEOUT_MS);
		ssh.stdout.on('data', (d) => (out += d.toString('utf-8')));
		ssh.stderr.on('data', (d) => (err += d.toString('utf-8')));
		ssh.on('close', (code) => {
			clearTimeout(timer);
			if (code === 0) resolve(out);
			else reject(new Error((err.trim() || `ssh exited with code ${code}`).slice(0, 200)));
		});
		ssh.on('error', (e) => {
			clearTimeout(timer);
			reject(e);
		});
	});
}

// ---- Prod host (the machine this container runs on) ----------------------
// docker-compose mounts the host's cgroup tree read-only at /host/cgroup. On
// an LXC host that tree is the LXC's own cgroup, giving its real CPU and RAM
// use; without it (or on a full VM) fall back to /proc, which is accurate
// there. Disk comes from statfs on a bind-mounted host directory, which
// reports the host's root filesystem rather than the container's layer.
const HOST_CGROUP = '/host/cgroup';
const HOST_DISK_PATHS = ['/keys/zap', '/keys/nuclei', '/'];

async function readText(path) {
	try {
		return (await fs.readFile(path, 'utf-8')).trim();
	} catch {
		return null;
	}
}

function countCpuList(list) {
	// "0-3,6" → 5
	let n = 0;
	for (const part of String(list).split(',')) {
		const [a, b] = part.split('-').map(Number);
		if (Number.isFinite(a)) n += Number.isFinite(b) ? b - a + 1 : 1;
	}
	return n || null;
}

async function collectLocal() {
	const lines = [];

	for (const p of HOST_DISK_PATHS) {
		try {
			const s = await fs.statfs(p);
			const kb = (blocks) => (blocks * s.bsize) / 1024;
			lines.push(`DISK host ${kb(s.blocks)} ${kb(s.blocks - s.bfree)} ${kb(s.bavail)} - ${p}`);
			break;
		} catch {
			// try the next path
		}
	}

	const memMax = await readText(`${HOST_CGROUP}/memory.max`);
	const memCur = await readText(`${HOST_CGROUP}/memory.current`);
	if (memMax && /^\d+$/.test(memMax) && memCur) {
		// Like free's "used": exclude page cache the kernel can reclaim.
		const stat = (await readText(`${HOST_CGROUP}/memory.stat`)) ?? '';
		const inactiveFile = Number(stat.match(/^inactive_file (\d+)/m)?.[1] ?? 0);
		const mb = (b) => b / 1024 / 1024;
		const total = mb(Number(memMax));
		const used = mb(Number(memCur) - inactiveFile);
		lines.push(`MEM Mem: ${total} ${used} 0 0 0 ${total - used}`);
	} else {
		const info = (await readText('/proc/meminfo')) ?? '';
		const kb = (k) => Number(info.match(new RegExp(`^${k}:\\s+(\\d+)`, 'm'))?.[1] ?? NaN);
		const total = kb('MemTotal') / 1024;
		const avail = kb('MemAvailable') / 1024;
		if (Number.isFinite(total) && Number.isFinite(avail)) lines.push(`MEM Mem: ${total} ${total - avail} 0 0 0 ${avail}`);
	}

	const cpuStat = await readText(`${HOST_CGROUP}/cpu.stat`);
	const usage = cpuStat?.match(/^usage_usec (\d+)/m)?.[1];
	if (usage) {
		lines.push(`CPUUSEC ${usage}`);
		const cpus = countCpuList((await readText(`${HOST_CGROUP}/cpuset.cpus.effective`)) ?? '');
		lines.push(`NCPU ${cpus ?? os.availableParallelism()}`);
	} else {
		// /proc/stat busy jiffies (USER_HZ = 100) expressed as microseconds.
		const first = (await readText('/proc/stat'))?.split('\n')[0]?.split(/\s+/).slice(1).map(Number) ?? [];
		if (first.length >= 5) {
			const total = first.reduce((a, b) => a + b, 0);
			const idle = first[3] + (first[4] ?? 0);
			lines.push(`CPUUSEC ${(total - idle) * 10_000}`);
			lines.push(`NCPU ${os.availableParallelism()}`);
		}
	}
	return lines.join('\n');
}

// ---- Collection loop -----------------------------------------------------
/** @type {Map<string, Sample>} latest sample per VM (failed ones included) */
const latest = new Map();
/** @type {Map<string, { usec: number, at: number }>} last CPU counter per VM */
const lastCpu = new Map();
let lastCleanup = 0;
let dbWarned = false;

function timeBox(promise) {
	return Promise.race([
		promise,
		new Promise((_, rej) => setTimeout(() => rej(new Error('ไม่ตอบภายใน 20 วินาที')), COLLECT_TIMEOUT_MS))
	]);
}

/** @returns {Promise<Sample>} */
async function sampleOne(target) {
	try {
		const parsed = parseHostStats(await timeBox(target.collect()));
		const at = Date.now();
		const curr = parsed.cpuUsec != null ? { usec: parsed.cpuUsec, at } : null;
		const cpuPct = cpuPercent(lastCpu.get(target.id), curr, parsed.cpus);
		if (curr) lastCpu.set(target.id, curr);
		if (!parsed.disk && !parsed.mem) throw new Error('อ่านค่าจากเครื่องไม่ได้ (ไม่พบ DISK/MEM)');
		return { vm: target.id, at, ok: true, error: null, cpuPct, cpus: parsed.cpus, mem: parsed.mem, disk: parsed.disk };
	} catch (e) {
		return {
			vm: target.id,
			at: Date.now(),
			ok: false,
			error: e instanceof Error ? e.message : String(e),
			cpuPct: null,
			cpus: null,
			mem: null,
			disk: null
		};
	}
}

async function store(samples) {
	const values = [];
	const params = [];
	for (const s of samples) {
		const base = params.length;
		values.push(`($${base + 1}, to_timestamp($${base + 2} / 1000.0), $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11})`);
		params.push(
			s.vm,
			s.at,
			s.ok,
			s.cpuPct,
			s.mem?.usedPct ?? null,
			s.mem?.usedMb ?? null,
			s.mem?.totalMb ?? null,
			s.disk?.usedPct ?? null,
			s.disk?.usedGb ?? null,
			s.disk?.totalGb ?? null,
			s.error
		);
	}
	await pool.query(
		`INSERT INTO vm_metrics (vm, ts, ok, cpu_pct, mem_pct, mem_used_mb, mem_total_mb, disk_pct, disk_used_gb, disk_total_gb, error)
		 VALUES ${values.join(', ')} ON CONFLICT DO NOTHING`,
		params
	);
	if (Date.now() - lastCleanup > 3_600_000) {
		lastCleanup = Date.now();
		await pool.query(`DELETE FROM vm_metrics WHERE ts < now() - make_interval(days => $1)`, [RETENTION_DAYS]);
	}
}

/** Take one round of samples from every machine. Exported for tests/manual runs. */
export async function collectOnce() {
	const samples = await Promise.all(monitorTargets().map(sampleOne));
	for (const s of samples) {
		// Keep the last good figures visible while a VM is briefly unreachable;
		// the error and age tell the viewer it's stale.
		const prev = latest.get(s.vm);
		latest.set(s.vm, s.ok || !prev ? s : { ...prev, ok: false, error: s.error, failedAt: s.at });
	}
	try {
		await store(samples);
		dbWarned = false;
	} catch (e) {
		// Usually: migration 024 not applied yet. Live views still work.
		if (!dbWarned) console.warn(`[monitor] บันทึก vm_metrics ไม่ได้: ${e instanceof Error ? e.message : e}`);
		dbWarned = true;
	}
	return samples;
}

/** Latest sample per VM, in display order, with its display name and host. */
export function getLatest() {
	return monitorTargets().map((t) => ({ id: t.id, name: t.name, host: t.host, sample: latest.get(t.id) ?? null }));
}

/**
 * Health level of one latest sample against THRESHOLDS.
 * @returns {{ state: 'ok'|'warn'|'crit'|'down'|'unknown', reasons: string[] }}
 */
export function assess(sample, now = Date.now()) {
	if (!sample) return { state: 'unknown', reasons: ['ยังไม่มีข้อมูล'] };
	const reasons = [];
	let state = 'ok';
	const bump = (s) => {
		const order = ['ok', 'warn', 'crit', 'down'];
		if (order.indexOf(s) > order.indexOf(state)) state = s;
	};
	if (!sample.ok || now - sample.at > STALE_MS) {
		bump('down');
		reasons.push(sample.error ? `ติดต่อไม่ได้: ${sample.error}` : 'ไม่มีข้อมูลใหม่เกิน 3 นาที');
	}
	const check = (key, label, value, extra = '') => {
		if (value == null) return;
		const t = THRESHOLDS[key];
		if (value >= t.crit) {
			bump('crit');
			reasons.push(`${label} ${value}%${extra}`);
		} else if (value >= t.warn) {
			bump('warn');
			reasons.push(`${label} ${value}%${extra}`);
		}
	};
	check('disk', 'ดิสก์', sample.disk?.usedPct, sample.disk ? ` (เหลือ ${sample.disk.freeGb} GB)` : '');
	check('mem', 'RAM', sample.mem?.usedPct);
	check('cpu', 'CPU', sample.cpuPct);
	return { state, reasons };
}

/** VMs currently needing attention, for the top-bar badge. */
export function activeAlerts() {
	return getLatest()
		.map((v) => ({ ...v, ...assess(v.sample) }))
		.filter((v) => v.state === 'warn' || v.state === 'crit' || v.state === 'down');
}

/** Start the background loop once per server process. */
export function startMonitor() {
	const g = /** @type {any} */ (globalThis);
	if (g.__vaMonitorStarted) return;
	g.__vaMonitorStarted = true;
	const tick = () => collectOnce().catch((e) => console.warn('[monitor]', e));
	tick();
	setInterval(tick, INTERVAL_MS).unref?.();
}

const BUCKETS = {
	'1h': { interval: '1 hour', bucket: '1 minute' },
	'24h': { interval: '24 hours', bucket: '5 minutes' },
	'7d': { interval: '7 days', bucket: '30 minutes' },
	'30d': { interval: '30 days', bucket: '2 hours' }
};
export const RANGES = Object.keys(BUCKETS);

/**
 * History for charts, bucketed so every range returns at most a few hundred
 * points per VM. CPU/RAM are averaged per bucket (CPU also keeps the peak);
 * disk uses the bucket's highest value.
 * @param {string} range one of RANGES
 */
export async function getHistory(range) {
	const { interval, bucket } = BUCKETS[range] ?? BUCKETS['24h'];
	const { rows } = await pool.query(
		`SELECT vm,
		        date_bin($2::interval, ts, TIMESTAMPTZ '2000-01-01') AS t,
		        round(avg(cpu_pct)::numeric, 1)::float AS cpu,
		        round(max(cpu_pct)::numeric, 1)::float AS cpu_max,
		        round(avg(mem_pct)::numeric, 1)::float AS mem,
		        max(disk_pct)::float AS disk,
		        bool_and(ok) AS ok
		   FROM vm_metrics
		  WHERE ts > now() - $1::interval
		  GROUP BY vm, t
		  ORDER BY vm, t`,
		[interval, bucket]
	);
	/** @type {Record<string, any[]>} */
	const byVm = {};
	for (const r of rows) (byVm[r.vm] ??= []).push({ t: r.t, cpu: r.cpu, cpuMax: r.cpu_max, mem: r.mem, disk: r.disk, ok: r.ok });
	return byVm;
}
