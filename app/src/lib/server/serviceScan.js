import { env } from '$env/dynamic/private';
import { startScan as startNuclei, peekPercent, isTracked } from './nuclei.js';
import { createAndLaunchScan, getScanStatus as nessusStatus, exportScanHtml } from './nessus.js';
import { finalizeNuclei } from './scanFinalize.js';
import { parseAndInsert } from './importReport.js';
import {
	insertScanJob,
	getScanJobByExternalId,
	updateScanJobByExternalId,
	listFindingSummariesForReport,
	countRunningScanJobsBy
} from './db.js';
import { expandTargetList, summarizeResolvedTargets } from './cidr.js';
import { isIpv4, isValidHostname } from '../hostRegistry.js';

/**
 * Scans started through the service API (see lib/server/serviceAuth.js) —
 * the same Nuclei / Nessus runs the scan page starts, recorded in scan_jobs
 * under the calling system's name, with results read back as plain findings.
 *
 * Limits, all overridable in .env:
 *   SERVICE_ALLOWED_NETS     IPv4 ranges targets must fall in (default 10.0.0.0/8)
 *   SERVICE_ALLOWED_DOMAINS  hostname suffixes targets must end in (default kku.ac.th)
 *   SERVICE_MAX_TARGETS      addresses per call (default 512)
 *   SERVICE_MAX_RUNNING      scans one caller may have running at once (default 2)
 *   SERVICE_NESSUS_ENABLED   "1" to offer Nessus — only once the Nessus license
 *                            allows starting scans over its API (scan_api)
 */

const CVE_RE = /^CVE-\d{4}-\d{4,}$/i;
const CIDR_RE = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/;

/** A problem with the caller's request — safe to show to the caller as-is. */
export class ServiceInputError extends Error {
	/** @param {string} message @param {number} [status] */
	constructor(message, status = 400) {
		super(message);
		this.status = status;
	}
}

function intEnv(name, fallback) {
	const n = Number.parseInt(env[name] ?? '', 10);
	return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Tools the service API offers. Nessus stays off by default: the current
 * Nessus Professional license has scan_api disabled, so starting a scan over
 * its API is refused (HTTP 412) and the tool would only ever fail.
 */
export function serviceTools() {
	return env.SERVICE_NESSUS_ENABLED === '1' ? ['nuclei', 'nessus'] : ['nuclei'];
}
export function maxServiceTargets() {
	return intEnv('SERVICE_MAX_TARGETS', 512);
}
export function maxServiceRunning() {
	return intEnv('SERVICE_MAX_RUNNING', 2);
}

function ipToInt(ip) {
	return ip.split('.').reduce((n, o) => ((n << 8) | Number(o)) >>> 0, 0);
}

/** @returns {{ base: number, prefix: number }[]} */
function allowedNets() {
	return String(env.SERVICE_ALLOWED_NETS || '10.0.0.0/8')
		.split(',')
		.map((s) => s.trim().match(CIDR_RE))
		.filter(Boolean)
		.map((m) => {
			const prefix = Number(m[2]);
			const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
			// >>> 0 keeps it unsigned: `&` yields a signed int, which breaks for ranges ≥ 128.0.0.0.
			return { base: (ipToInt(m[1]) & mask) >>> 0, prefix };
		});
}

function allowedDomains() {
	return String(env.SERVICE_ALLOWED_DOMAINS || 'kku.ac.th')
		.split(',')
		.map((s) => s.trim().toLowerCase().replace(/^\*?\./, ''))
		.filter(Boolean);
}

/** Whether a whole block (ip/prefix) lies inside one of the allowed ranges. */
function insideAllowedNets(ip, prefix = 32) {
	const addr = ipToInt(ip);
	return allowedNets().some(({ base, prefix: p }) => {
		if (prefix < p) return false;
		const mask = p === 0 ? 0 : (~0 << (32 - p)) >>> 0;
		return ((addr & mask) >>> 0) === base;
	});
}

/** Throws unless every target is inside the allowed ranges / domains. */
function assertInScope(t) {
	const cidr = t.match(CIDR_RE);
	if (cidr) {
		if (!insideAllowedNets(cidr[1], Number(cidr[2]))) {
			throw new ServiceInputError(`target นอกขอบเขตที่อนุญาต: "${t}"`, 403);
		}
		return;
	}
	if (isIpv4(t)) {
		if (!insideAllowedNets(t)) throw new ServiceInputError(`target นอกขอบเขตที่อนุญาต: "${t}"`, 403);
		return;
	}
	if (!allowedDomains().some((d) => t === d || t.endsWith(`.${d}`))) {
		throw new ServiceInputError(`target นอกขอบเขตที่อนุญาต: "${t.slice(0, 80)}"`, 403);
	}
}

/**
 * Validate and expand a target list.
 * @param {unknown} targets array of IPv4 / CIDR / hostname
 * @returns {{ targets: string[], resolved: string[] }}
 */
export function validateTargets(targets) {
	if (!Array.isArray(targets) || targets.length === 0) {
		throw new ServiceInputError('ต้องระบุ targets เป็น array อย่างน้อย 1 รายการ');
	}
	const clean = [...new Set(targets.map((t) => String(t ?? '').trim().toLowerCase()).filter(Boolean))];
	for (const t of clean) {
		if (!isIpv4(t) && !CIDR_RE.test(t) && !isValidHostname(t)) {
			throw new ServiceInputError(`target ไม่ถูกต้อง: "${t.slice(0, 80)}"`);
		}
		assertInScope(t);
	}
	let resolved;
	try {
		resolved = expandTargetList(clean.join(','), 1024);
	} catch (e) {
		throw new ServiceInputError(e instanceof Error ? e.message : String(e));
	}
	const max = maxServiceTargets();
	if (resolved.length > max) {
		throw new ServiceInputError(`จำนวนเครื่องเกินกำหนด (${resolved.length} > ${max}) — แบ่งสแกนเป็นหลายงาน`);
	}
	return { targets: clean, resolved };
}

/** Per-caller queue so two simultaneous requests can't both pass the running-scan cap. */
const callerLocks = new Map();

/**
 * @param {{ tool: string, targets: string[], cveId?: string|null, label?: string|null }} req
 * @param {string} caller service name (e.g. "soct")
 * @returns {Promise<{ tool: string, jobId: string }>}
 */
export function startServiceScan(req, caller) {
	const prev = callerLocks.get(caller) ?? Promise.resolve();
	const run = prev.catch(() => {}).then(() => startServiceScanUnlocked(req, caller));
	callerLocks.set(caller, run);
	return run.finally(() => {
		if (callerLocks.get(caller) === run) callerLocks.delete(caller);
	});
}

async function startServiceScanUnlocked({ tool, targets, cveId = null, label = null }, caller) {
	const tools = serviceTools();
	if (!tools.includes(tool)) throw new ServiceInputError(`tool ต้องเป็น ${tools.join(' / ')}`);
	const { targets: list, resolved } = validateTargets(targets);
	const cve = cveId ? String(cveId).trim().toUpperCase() : null;
	if (cve && !CVE_RE.test(cve)) throw new ServiceInputError(`รูปแบบ CVE ไม่ถูกต้อง: "${cve.slice(0, 40)}"`);
	// Nuclei through the service API is always CVE-targeted: a full template
	// run across many hosts is too heavy to start without a person deciding.
	if (tool === 'nuclei' && !cve) throw new ServiceInputError('สแกน Nuclei ผ่าน service API ต้องระบุ cveId');

	const createdBy = `svc:${caller}`;
	// Cap how many scans one system can have in flight, so an automated
	// caller can't pile up concurrent sweeps on the scanner VMs and targets.
	const running = await countRunningScanJobsBy(createdBy);
	const maxRunning = maxServiceRunning();
	if (running >= maxRunning) {
		throw new ServiceInputError(
			`มีงานสแกนของ ${caller} รันอยู่ ${running} งานแล้ว (สูงสุด ${maxRunning}) — รอให้เสร็จก่อนแล้วค่อยสั่งใหม่`,
			429
		);
	}

	const note = String(label ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 120) || null;
	const extra = [cve, note, `โดย ${caller}`].filter(Boolean).join(' · ');
	const target = list.join(', ');

	if (tool === 'nuclei') {
		let markRowReady;
		const rowReady = new Promise((r) => (markRowReady = r));
		const jobId = startNuclei([{ hostHeader: null, targets: list }], cve, async (id, outcome) => {
			await rowReady;
			return finalizeNuclei(id, outcome);
		});
		await insertScanJob({
			tool,
			target,
			externalId: jobId,
			extra,
			resolvedTargets: summarizeResolvedTargets(resolved),
			createdBy
		}).finally(markRowReady);
		return { tool, jobId };
	}
	const { scanId } = await createAndLaunchScan(
		`VA Scan - ${caller}${note ? ' - ' + note : ''} - ${new Date().toISOString()}`,
		list.join(', ')
	);
	await insertScanJob({
		tool,
		target,
		externalId: String(scanId),
		extra,
		resolvedTargets: summarizeResolvedTargets(resolved),
		createdBy
	});
	return { tool, jobId: String(scanId) };
}

function reportIdsOf(result) {
	if (!result) return [];
	const ids = [result.reportId ?? result.existingReportId];
	(result.results ?? []).forEach((r) => ids.push(r.reportId ?? r.existingReportId));
	return [...new Set(ids.filter((x) => Number.isInteger(Number(x)) && x != null).map(Number))];
}

async function findingsFor(reportIds) {
	const out = [];
	for (const id of reportIds) {
		for (const f of await listFindingSummariesForReport(id)) {
			out.push({
				report_id: Number(id),
				target: f.target,
				identifier: f.identifier,
				title: f.title,
				severity: f.severity,
				cvss_score: f.cvss_score == null ? null : Number(f.cvss_score),
				cve: f.cve,
				affected_url_or_port: f.affected_url_or_port
			});
			if (out.length >= 5000) return out;
		}
	}
	return out;
}

/**
 * State of a service-started scan; findings are included once it is done.
 * Only jobs the same caller started are visible.
 * @returns {Promise<null | { status: 'running'|'done'|'error', percent?: number|null, error?: string|null, reportIds?: number[], findings?: object[] }>}
 */
export async function getServiceScan(tool, jobId, caller) {
	if (!['nuclei', 'nessus'].includes(tool)) return null;
	const row = await getScanJobByExternalId(tool, String(jobId));
	if (!row || row.created_by !== `svc:${caller}`) return null;

	if (row.status === 'error') return { status: 'error', error: row.error_message };
	if (row.status === 'done') {
		// Already imported — serve the stored findings instead of importing again.
		const ids = reportIdsOf({ reportId: row.report_id });
		return { status: 'done', reportIds: ids, findings: await findingsFor(ids) };
	}

	if (tool === 'nuclei') {
		// A job started before the last restart is no longer in memory and will never finish.
		if (!isTracked(String(jobId))) {
			await updateScanJobByExternalId('nuclei', String(jobId), {
				status: 'error',
				errorMessage: 'งานสแกนหายเพราะระบบรีสตาร์ท'
			});
			return { status: 'error', error: 'งานสแกนหายเพราะระบบรีสตาร์ท — สั่งสแกนใหม่' };
		}
		return { status: 'running', percent: peekPercent(String(jobId)) };
	}

	// Nessus: like the scan page's status route — import the results once, when the scan completes.
	const { status } = await nessusStatus(Number(jobId));
	if (status === 'canceled' || status === 'aborted') {
		await updateScanJobByExternalId('nessus', String(jobId), {
			status: 'error',
			errorMessage: `สแกนถูกยกเลิก (${status})`
		});
		return { status: 'error', error: `สแกนถูกยกเลิก (${status})` };
	}
	if (status !== 'completed' && status !== 'imported') return { status: 'running', percent: null };
	const result = await parseAndInsert(`nessus-scan-${jobId}.html`, await exportScanHtml(Number(jobId)));
	const ids = reportIdsOf(result);
	await updateScanJobByExternalId('nessus', String(jobId), { status: 'done', reportId: ids[0] ?? null });
	return { status: 'done', reportIds: ids, findings: await findingsFor(ids) };
}
