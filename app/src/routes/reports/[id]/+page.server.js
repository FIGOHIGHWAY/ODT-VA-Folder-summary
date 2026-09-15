import { error } from '@sveltejs/kit';
import { listFindingsForReport, hasOriginalFile } from '$lib/server/db.js';
import { canDelete } from '$lib/server/permissions.js';

export async function load({ params, locals }) {
	const reportId = Number(params.id);
	if (!Number.isInteger(reportId)) {
		throw error(400, 'invalid report id');
	}
	const [findings, hasOriginal] = await Promise.all([
		listFindingsForReport(reportId),
		hasOriginalFile(reportId)
	]);
	return {
		reportId,
		findings,
		hasOriginal,
		canDelete: canDelete(locals.user?.role ?? 'user')
	};
}
