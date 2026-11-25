/**
 * Health of each scanner VM for the scan page's status panel: whether the
 * tool's service answers (checked here, time-boxed, cached briefly) plus the
 * VM's disk / RAM / CPU taken from the resource monitor's latest sample.
 */
import { getZapHealth, zapVmHost } from './zap.js';
import { getNucleiHealth, nucleiVmHost } from './nuclei.js';
import { getOpenvasHealth, openvasVmHost } from './openvas.js';
import { getNessusHealth, nessusVmHost } from './nessus.js';
import { getLatest, assess, THRESHOLDS } from './monitor.js';

const CACHE_MS = 30_000;
const CHECK_TIMEOUT_MS = 15_000;
const FEED_STALE_DAYS = 7;
const LICENSE_WARN_DAYS = 30;

/**
 * @typedef {{
 *   id: string, name: string, host: string|null, state: 'ok'|'warn'|'down',
 *   version: string|null, facts: { label: string, value: string }[],
 *   disk: { usedPct: number, freeGb: number, totalGb: number }|null,
 *   mem: { usedPct: number, totalGb: number }|null,
 *   cpus: number|null, cpuPct: number|null,
 *   notes: string[], checkedAt: string
 * }} ToolStatus
 */

/** "202611250605" → Date, or null. */
export function parseFeedVersion(v) {
	const m = String(v ?? '').match(/^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?$/);
	if (!m) return null;
	const [, y, mo, d, h = '0', mi = '0'] = m;
	return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi));
}

function daysUntil(unixSeconds) {
	return Math.floor((unixSeconds * 1000 - Date.now()) / 86_400_000);
}

function ageText(date) {
	const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
	return {
		days,
		text: `${date.toLocaleDateString('th-TH', { dateStyle: 'medium' })}${days > 0 ? ` (${days} วันก่อน)` : ' (วันนี้)'}`
	};
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

/** @returns {ToolStatus} */
function base(id, name, host) {
	return {
		id,
		name,
		host,
		state: 'ok',
		version: null,
		facts: [],
		disk: null,
		mem: null,
		cpus: null,
		cpuPct: null,
		notes: [],
		checkedAt: new Date().toISOString()
	};
}

/** Copy the monitor's latest disk/RAM/CPU onto a status and apply its warnings. */
function withResources(s) {
	const entry = getLatest().find((v) => v.id === s.id);
	const sample = entry?.sample;
	if (sample) {
		s.disk = sample.disk;
		s.mem = sample.mem;
		s.cpus = sample.cpus;
		s.cpuPct = sample.cpuPct;
		const { state, reasons } = assess(sample);
		// A monitor that can't reach the VM doesn't mean the tool is down (the
		// service check decides that), so only resource warnings carry over.
		if (state === 'warn' || state === 'crit') {
			s.notes.push(...reasons.map((r) => `${r} — ถ้าเต็ม การสแกนอาจล้ม`));
			if (s.state === 'ok') s.state = 'warn';
		}
	}
	return s;
}

async function checkZap() {
	const s = base('zap', 'OWASP ZAP', zapVmHost());
	try {
		const h = await timeBox(getZapHealth());
		s.version = h.version;
		if (h.apiError) {
			s.state = 'down';
			s.notes.push(`ZAP API ไม่ตอบ: ${h.apiError}`);
		}
	} catch (e) {
		s.state = 'down';
		s.notes.push(errText(e));
	}
	return withResources(s);
}

async function checkNuclei() {
	const s = base('nuclei', 'Nuclei', nucleiVmHost());
	try {
		const out = await timeBox(getNucleiHealth());
		s.version = out.match(/^VER (\S+)/m)?.[1] ?? null;
		if (!s.version) {
			s.state = 'warn';
			s.notes.push('เข้าเครื่องได้ แต่เรียกคำสั่ง nuclei ไม่ได้');
		}
	} catch (e) {
		s.state = 'down';
		s.notes.push(`SSH เข้าเครื่องไม่ได้: ${errText(e)}`);
	}
	return withResources(s);
}

async function checkOpenvas() {
	const s = base('openvas', 'OpenVAS', openvasVmHost());
	try {
		const h = await timeBox(getOpenvasHealth());
		s.version = h.gmpVersion ? `GMP ${h.gmpVersion}` : null;
		if (h.runningTasks != null) s.facts.push({ label: 'กำลังสแกน', value: `${h.runningTasks} งาน` });
		const feedDate = parseFeedVersion(h.feedVersion);
		if (feedDate) {
			const age = ageText(feedDate);
			s.facts.push({ label: 'Feed ช่องโหว่', value: age.text });
			if (age.days > FEED_STALE_DAYS) {
				s.state = 'warn';
				s.notes.push(`feed ช่องโหว่ไม่ได้อัปเดตมา ${age.days} วัน — ผลสแกนอาจตกหล่นช่องโหว่ใหม่`);
			}
		}
		if (h.feedSyncing) s.facts.push({ label: 'Feed', value: 'กำลังซิงก์' });
	} catch (e) {
		s.state = 'down';
		s.notes.push(`เชื่อมต่อ GMP ไม่ได้: ${errText(e)}`);
	}
	return withResources(s);
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
			const age = ageText(pluginDate);
			s.facts.push({ label: 'Plugin อัปเดต', value: age.text });
			if (age.days > FEED_STALE_DAYS) {
				s.state = 'warn';
				s.notes.push(`plugin ไม่ได้อัปเดตมา ${age.days} วัน`);
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
			s.notes.push('license รองรับการสั่งสแกนผ่าน API แล้ว — เปิด NESSUS_SCAN_ENABLED ในหน้าสั่งสแกนได้');
		}
	} catch (e) {
		s.state = 'down';
		s.notes.push(errText(e));
	}
	return withResources(s);
}

/** @type {{ at: number, value: { tools: ToolStatus[], checkedAt: string, thresholds: typeof THRESHOLDS } } | null} */
let cache = null;
/** @type {Promise<{ tools: ToolStatus[], checkedAt: string, thresholds: typeof THRESHOLDS }> | null} */
let inFlight = null;

/**
 * @param {{ force?: boolean, nessusScanEnabled?: boolean }} [opts]
 */
export async function getToolStatuses({ force = false, nessusScanEnabled = false } = {}) {
	if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.value;
	if (inFlight) return inFlight;
	inFlight = (async () => {
		const tools = await Promise.all([checkZap(), checkOpenvas(), checkNuclei(), checkNessus(nessusScanEnabled)]);
		const value = { tools, checkedAt: new Date().toISOString(), thresholds: THRESHOLDS };
		cache = { at: Date.now(), value };
		return value;
	})().finally(() => {
		inFlight = null;
	});
	return inFlight;
}
