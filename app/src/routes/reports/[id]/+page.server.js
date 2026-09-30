import { error } from '@sveltejs/kit';
import { listFindingsForReport, hasOriginalFile, getReportMeta } from '$lib/server/db.js';
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
	return {
		reportId,
		findings,
		hasOriginal,
		meta,
		canDelete: canDelete(locals.user?.role ?? 'user')
	};
}
