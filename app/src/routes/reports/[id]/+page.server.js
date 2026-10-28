import { error } from '@sveltejs/kit';
import { listFindingsForReport, hasOriginalFile, getReportMeta, listHostRegistry } from '$lib/server/db.js';
import { buildNetworkSummary } from '$lib/server/cidr.js';
import { canDelete, canUpload } from '$lib/server/permissions.js';
import { withoutFalsePositives } from '$lib/triage.js';

export async function load({ params, locals }) {
	const reportId = Number(params.id);
	if (!Number.isInteger(reportId)) {
		throw error(400, 'invalid report id');
	}
	const [findings, hasOriginal, meta, hosts] = await Promise.all([
		listFindingsForReport(reportId),
		hasOriginalFile(reportId),
		getReportMeta(reportId),
		listHostRegistry()
	]);
	if (!meta) {
		throw error(404, 'report not found');
	}
	const networkSummary = meta.scan_target ? buildNetworkSummary(meta.scan_target, withoutFalsePositives(findings)) : null;
	return {
		reportId,
		findings,
		hasOriginal,
		meta,
		networkSummary,
		hosts,
		canDelete: canDelete(locals.user?.role ?? 'user'),
		canTriage: canUpload(locals.user?.role ?? 'user')
	};
}
