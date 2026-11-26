import { startScan as startNuclei, peekPercent, isTracked } from './nuclei.js';
import { createAndLaunchScan, getScanStatus as nessusStatus, exportScanHtml } from './nessus.js';
import { finalizeNuclei } from './scanFinalize.js';
import { parseAndInsert } from './importReport.js';
import { insertScanJob, getScanJobByExternalId, updateScanJobByExternalId, listFindingSummariesForReport } from './db.js';
import { expandTargetList, summarizeResolvedTargets } from './cidr.js';
import { isIpv4, isValidHostname } from '../hostRegistry.js';

/**
 * Scans started through the service API (see lib/server/serviceAuth.js) —
 * the same Nuclei / Nessus runs the scan page starts, recorded in scan_jobs
 * under the calling system's name, with results read back as plain findings.
 */

export const SERVICE_TOOLS = ['nuclei', 'nessus'];
const CVE_RE = /^CVE-\d{4}-\d{4,}$/i;
const CIDR_RE = /^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/;
// One service call may not sweep more than this many addresses.
export const MAX_SERVICE_TARGETS = Number(process.env.SERVICE_MAX_TARGETS || 512);

/**
 * Validate and expand a target list.
 * @param {unknown} targets array of IPv4 / CIDR / hostname
 * @returns {{ targets: string[], resolved: string[] }}
 */
export function validateTargets(targets) {
	if (!Array.isArray(targets) || targets.length === 0) throw new Error('ต้องระบุ targets เป็น array อย่างน้อย 1 รายการ');
	const clean = [...new Set(targets.map((t) => String(t ?? '').trim().toLowerCase()).filter(Boolean))];
	for (const t of clean) {
		if (!isIpv4(t) && !CIDR_RE.test(t) && !isValidHostname(t)) throw new Error(`target ไม่ถูกต้อง: "${t.slice(0, 80)}"`);
	}
	const resolved = expandTargetList(clean.join(','), 1024);
	if (resolved.length > MAX_SERVICE_TARGETS) {
		throw new Error(`จำนวนเครื่องเกินกำหนด (${resolved.length} > ${MAX_SERVICE_TARGETS}) — แบ่งสแกนเป็นหลายงาน`);
	}
	return { targets: clean, resolved };
}

/**
 * @param {{ tool: string, targets: string[], cveId?: string|null, label?: string|null }} req
 * @param {string} caller service name (e.g. "soct")
 * @returns {Promise<{ tool: string, jobId: string }>}
 */
export async function startServiceScan({ tool, targets, cveId = null, label = null }, caller) {
	if (!SERVICE_TOOLS.includes(tool)) throw new Error(`tool ต้องเป็น ${SERVICE_TOOLS.join(' / ')}`);
	const { targets: list, resolved } = validateTargets(targets);
	const cve = cveId ? String(cveId).trim().toUpperCase() : null;
	if (cve && !CVE_RE.test(cve)) throw new Error(`รูปแบบ CVE ไม่ถูกต้อง: "${cve.slice(0, 40)}"`);
	// Nuclei through the service API is always CVE-targeted: a full template
	// run across many hosts is too heavy to start without a person deciding.
	if (tool === 'nuclei' && !cve) throw new Error('สแกน Nuclei ผ่าน service API ต้องระบุ cveId');
	const note = String(label ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 120) || null;
	const createdBy = `svc:${caller}`;
	const extra = [cve, note, `โดย ${caller}`].filter(Boolean).join(' · ');
	const target = list.join(', ');

	if (tool === 'nuclei') {
		let markRowReady;
		const rowReady = new Promise((r) => (markRowReady = r));
		const jobId = startNuclei([{ hostHeader: null, targets: list }], cve, async (id, outcome) => {
			await rowReady;
			return finalizeNuclei(id, outcome);
		});
		await insertScanJob({ tool, target, externalId: jobId, extra, resolvedTargets: summarizeResolvedTargets(resolved), createdBy }).finally(markRowReady);
		return { tool, jobId };
	}
	const { scanId } = await createAndLaunchScan(`VA Scan - ${caller}${note ? ' - ' + note : ''} - ${new Date().toISOString()}`, list.join(', '));
	await insertScanJob({ tool, target, externalId: String(scanId), extra, resolvedTargets: summarizeResolvedTargets(resolved), createdBy });
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
	if (!SERVICE_TOOLS.includes(tool)) return null;
	const row = await getScanJobByExternalId(tool, String(jobId));
	if (!row || row.created_by !== `svc:${caller}`) return null;

	if (tool === 'nuclei') {
		if (row.status === 'error') return { status: 'error', error: row.error_message };
		if (row.status === 'done') {
			const ids = reportIdsOf({ reportId: row.report_id });
			return { status: 'done', reportIds: ids, findings: await findingsFor(ids) };
		}
		// A job started before the last restart is no longer in memory and will never finish.
		if (!isTracked(String(jobId))) {
			await updateScanJobByExternalId('nuclei', String(jobId), { status: 'error', errorMessage: 'งานสแกนหายเพราะระบบรีสตาร์ท' });
			return { status: 'error', error: 'งานสแกนหายเพราะระบบรีสตาร์ท — สั่งสแกนใหม่' };
		}
		return { status: 'running', percent: peekPercent(String(jobId)) };
	}

	// Nessus: like the scan page's status route — import the results once the scan completes.
	if (row.status === 'error') return { status: 'error', error: row.error_message };
	const { status } = await nessusStatus(Number(jobId));
	if (status === 'canceled' || status === 'aborted') {
		await updateScanJobByExternalId('nessus', String(jobId), { status: 'error', errorMessage: `สแกนถูกยกเลิก (${status})` });
		return { status: 'error', error: `สแกนถูกยกเลิก (${status})` };
	}
	if (status !== 'completed' && status !== 'imported') return { status: 'running', percent: null };
	const result = await parseAndInsert(`nessus-scan-${jobId}.html`, await exportScanHtml(Number(jobId)));
	const ids = reportIdsOf(result);
	await updateScanJobByExternalId('nessus', String(jobId), { status: 'done', reportId: ids[0] ?? null });
	return { status: 'done', reportIds: ids, findings: await findingsFor(ids) };
}
