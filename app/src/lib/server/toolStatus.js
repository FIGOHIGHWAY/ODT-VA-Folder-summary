/**
 * Health of each scanner VM for the scan page's status panel. Each check is
 * independent and time-boxed, so one dead VM never blocks the others, and
 * results are cached briefly so many open pages don't hammer the VMs.
 */
import { getZapHealth, zapVmHost } from './zap.js';
import { getNucleiHealth, nucleiVmHost } from './nuclei.js';
import { getOpenvasHealth, openvasVmHost } from './openvas.js';
import { getNessusHealth, nessusVmHost } from './nessus.js';

const CACHE_MS = 30_000;
const CHECK_TIMEOUT_MS = 15_000;

// Thresholds that turn a VM "warn" (yellow) instead of "ok".
export const DISK_WARN_PCT = 85;
const MEM_WARN_PCT = 90;
const FEED_STALE_DAYS = 7;
const LICENSE_WARN_DAYS = 30;

/**
 * @typedef {{ usedPct: number, freeGb: number, totalGb: number }} DiskInfo
 * @typedef {{ usedPct: number, totalGb: number }} MemInfo
 * @typedef {{
 *   id: string, name: string, host: string|null, state: 'ok'|'warn'|'down'|'off',
 *   version: string|null, facts: { label: string, value: string }[],
 *   disk: DiskInfo|null, mem: MemInfo|null, cpus: number|null,
 *   notes: string[], checkedAt: string
 * }} ToolStatus
 */

/**
 * Parse prefixed host stats lines (DISK/CPU/MEM, optionally VER) produced by
 * the ZAP pin helper's "stats" action and the Nuclei SSH health command.
 *   DISK <fs> <1K-blocks> <used> <avail> <use%> <mount>   (df -P)
 *   CPU <n>
 *   MEM Mem: <total> <used> <free> <shared> <buff/cache> <available>   (free -m)
 * @param {string} text
 * @returns {{ disk: DiskInfo|null, mem: MemInfo|null, cpus: number|null, version: string|null }}
 */
export function parseHostStats(text) {
	const line = (prefix) =>
		String(text ?? '')
			.split('\n')
			.find((l) => l.startsWith(`${prefix} `))
			?.slice(prefix.length + 1)
			.trim() ?? null;

	let disk = null;
	const d = line('DISK')?.split(/\s+/);
	if (d && d.length >= 5) {
		const total = Number(d[1]);
		const used = Number(d[2]);
		const avail = Number(d[3]);
		if (total > 0 && Number.isFinite(used) && Number.isFinite(avail)) {
			// Match df's Use%: used / (used + avail), which ignores root-reserved blocks.
			disk = {
				usedPct: Math.round((used / (used + avail)) * 100),
				freeGb: round1(avail / 1024 / 1024),
				totalGb: round1(total / 1024 / 1024)
			};
		}
	}

	let mem = null;
	const m = line('MEM')?.split(/\s+/);
	if (m && m.length >= 7) {
		const total = Number(m[1]);
		const available = Number(m[6]);
		if (total > 0 && Number.isFinite(available)) {
			mem = { usedPct: Math.round(((total - available) / total) * 100), totalGb: round1(total / 1024) };
		}
	}

	const cpus = Number.parseInt(line('CPU') ?? '', 10);
	return { disk, mem, cpus: Number.isFinite(cpus) ? cpus : null, version: line('VER') || null };
}

function round1(n) {
	return Math.round(n * 10) / 10;
}

/** Days from now until a unix-seconds timestamp (negative when past). */
function daysUntil(unixSeconds) {
	return Math.floor((unixSeconds * 1000 - Date.now()) / 86_400_000);
}

/** "202611250605" → Date, or null. */
export function parseFeedVersion(v) {
	const m = String(v ?? '').match(/^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?$/);
	if (!m) return null;
	const [, y, mo, d, h = '0', mi = '0'] = m;
	return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi));
}

function errText(e) {
	return e instanceof Error ? e.message : String(e);
}

function timeBox(promise) {
	return Promise.race([
		promise,
		new Promise((_, rej) => setTimeout(() => rej(new Error('ไม่ตอบภายใน 15 วินาที')), CHECK_TIMEOUT_MS))
	]);
}

/** Apply the shared disk/RAM warnings to a status. */
function applyHostWarnings(s) {
	if (s.disk && s.disk.usedPct >= DISK_WARN_PCT) {
		s.notes.push(`ดิสก์ใช้ไป ${s.disk.usedPct}% เหลือ ${s.disk.freeGb} GB — ถ้าเต็ม การสแกนจะล้ม`);
		if (s.state === 'ok') s.state = 'warn';
	}
	if (s.mem && s.mem.usedPct >= MEM_WARN_PCT) {
		s.notes.push(`RAM ใช้ไป ${s.mem.usedPct}%`);
		if (s.state === 'ok') s.state = 'warn';
	}
}

/** @returns {ToolStatus} */
function base(id, name, host) {
	return { id, name, host, state: 'ok', version: null, facts: [], disk: null, mem: null, cpus: null, notes: [], checkedAt: new Date().toISOString() };
}

async function checkZap() {
	const s = base('zap', 'OWASP ZAP', zapVmHost());
	try {
		const h = await timeBox(getZapHealth());
		s.version = h.version;
		if (h.stats) Object.assign(s, (({ disk, mem, cpus }) => ({ disk, mem, cpus }))(parseHostStats(h.stats)));
		if (h.apiError) {
			s.state = 'down';
			s.notes.push(`ZAP API ไม่ตอบ: ${h.apiError}`);
		}
		if (h.statsError) {
			s.notes.push(`อ่านสถานะเครื่องไม่ได้: ${h.statsError}`);
			if (s.state === 'ok') s.state = 'warn';
		}
	} catch (e) {
		s.state = 'down';
		s.notes.push(errText(e));
	}
	applyHostWarnings(s);
	return s;
}

async function checkNuclei() {
	const s = base('nuclei', 'Nuclei', nucleiVmHost());
	try {
		const parsed = parseHostStats(await timeBox(getNucleiHealth()));
		Object.assign(s, { disk: parsed.disk, mem: parsed.mem, cpus: parsed.cpus, version: parsed.version });
		if (!parsed.version) {
			s.state = 'warn';
			s.notes.push('เข้าเครื่องได้ แต่เรียกคำสั่ง nuclei ไม่ได้');
		}
	} catch (e) {
		s.state = 'down';
		s.notes.push(`SSH เข้าเครื่องไม่ได้: ${errText(e)}`);
	}
	applyHostWarnings(s);
	return s;
}

async function checkOpenvas() {
	const s = base('openvas', 'OpenVAS', openvasVmHost());
	try {
		const h = await timeBox(getOpenvasHealth());
		s.version = h.gmpVersion ? `GMP ${h.gmpVersion}` : null;
		if (h.runningTasks != null) s.facts.push({ label: 'กำลังสแกน', value: `${h.runningTasks} งาน` });
		const feedDate = parseFeedVersion(h.feedVersion);
		if (feedDate) {
			const ageDays = Math.floor((Date.now() - feedDate.getTime()) / 86_400_000);
			s.facts.push({
				label: 'Feed ช่องโหว่',
				value: `${feedDate.toLocaleDateString('th-TH', { dateStyle: 'medium' })}${ageDays > 0 ? ` (${ageDays} วันก่อน)` : ' (วันนี้)'}`
			});
			if (ageDays > FEED_STALE_DAYS) {
				s.state = 'warn';
				s.notes.push(`feed ช่องโหว่ไม่ได้อัปเดตมา ${ageDays} วัน — ผลสแกนอาจตกหล่นช่องโหว่ใหม่`);
			}
		}
		if (h.feedSyncing) s.facts.push({ label: 'Feed', value: 'กำลังซิงก์' });
	} catch (e) {
		s.state = 'down';
		s.notes.push(`เชื่อมต่อ GMP ไม่ได้: ${errText(e)}`);
	}
	return s;
}

async function checkNessus(scanEnabled) {
	const s = base('nessus', 'Nessus', nessusVmHost());
	try {
		const h = await timeBox(getNessusHealth());
		s.version = h.version;
		if (h.status !== 'ready') {
			s.state = 'warn';
			s.notes.push(`สถานะเซิร์ฟเวอร์: ${h.status}`);
		}
		const pluginDate = parseFeedVersion(h.pluginSet);
		if (pluginDate) {
			const ageDays = Math.floor((Date.now() - pluginDate.getTime()) / 86_400_000);
			s.facts.push({
				label: 'Plugin อัปเดต',
				value: `${pluginDate.toLocaleDateString('th-TH', { dateStyle: 'medium' })}${ageDays > 0 ? ` (${ageDays} วันก่อน)` : ' (วันนี้)'}`
			});
			if (ageDays > FEED_STALE_DAYS) {
				s.state = 'warn';
				s.notes.push(`plugin ไม่ได้อัปเดตมา ${ageDays} วัน`);
			}
		}
		if (h.licenseExpires) {
			const days = daysUntil(h.licenseExpires);
			s.facts.push({
				label: 'License หมดอายุ',
				value: new Date(h.licenseExpires * 1000).toLocaleDateString('th-TH', { dateStyle: 'medium' })
			});
			if (days < LICENSE_WARN_DAYS) {
				s.state = 'warn';
				s.notes.push(days < 0 ? 'license หมดอายุแล้ว' : `license จะหมดอายุในอีก ${days} วัน`);
			}
		}
		if (h.scanApi === false) {
			s.facts.push({ label: 'สั่งสแกนผ่าน API', value: 'license ไม่รองรับ · นำเข้าไฟล์ผลได้' });
		} else if (h.scanApi === true && !scanEnabled) {
			// License now allows it but the scan page still has it switched off.
			s.notes.push('license รองรับการสั่งสแกนผ่าน API แล้ว — เปิด NESSUS_SCAN_ENABLED ในหน้าสั่งสแกนได้');
		}
	} catch (e) {
		s.state = 'down';
		s.notes.push(errText(e));
	}
	return s;
}

/** @type {{ at: number, value: { tools: ToolStatus[], checkedAt: string } } | null} */
let cache = null;
/** @type {Promise<{ tools: ToolStatus[], checkedAt: string }> | null} */
let inFlight = null;

/**
 * @param {{ force?: boolean, nessusScanEnabled?: boolean }} [opts]
 * @returns {Promise<{ tools: ToolStatus[], checkedAt: string }>}
 */
export async function getToolStatuses({ force = false, nessusScanEnabled = false } = {}) {
	if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.value;
	if (inFlight) return inFlight;
	inFlight = (async () => {
		const tools = await Promise.all([checkZap(), checkOpenvas(), checkNuclei(), checkNessus(nessusScanEnabled)]);
		const value = { tools, checkedAt: new Date().toISOString() };
		cache = { at: Date.now(), value };
		return value;
	})().finally(() => {
		inFlight = null;
	});
	return inFlight;
}
