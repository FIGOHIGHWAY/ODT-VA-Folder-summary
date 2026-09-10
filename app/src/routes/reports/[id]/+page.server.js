import { error } from '@sveltejs/kit';
import { listFindingsForReport, hasOriginalFile } from '$lib/server/db.js';

export async function load({ params }) {
	const reportId = Number(params.id);
	if (!Number.isInteger(reportId)) {
		throw error(400, 'invalid report id');
	}
	const [findings, hasOriginal] = await Promise.all([
		listFindingsForReport(reportId),
		hasOriginalFile(reportId)
	]);
	return { reportId, findings, hasOriginal };
}
