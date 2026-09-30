import { error } from '@sveltejs/kit';
import { listFindingsForReport, hasOriginalFile, getReportMeta } from '$lib/server/db.js';
import { buildNetworkSummary } from '$lib/server/cidr.js';
import { canDelete } from '$lib/server/permissions.js';

export async function load({ params, locals }) {
	const reportId = Number(params.id);
	if (!Number.isInteger(reportId)) {
		throw error(400, 'invalid report id');
	}
	const [findings, hasOriginal, meta] = await Promise.all([
		listFindingsForReport(reportId),
		hasOriginalFile(reportId),
		getReportMeta(reportId)
	]);
	if (!meta) {
		throw error(404, 'report not found');
	}
	const networkSummary = meta.scan_target ? buildNetworkSummary(meta.scan_target, findings) : null;
	return {
		reportId,
		findings,
		hasOriginal,
		meta,
		networkSummary,
		canDelete: canDelete(locals.user?.role ?? 'user')
	};
}
