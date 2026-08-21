import { error } from '@sveltejs/kit';
import { listFindingsForReport } from '$lib/server/db.js';

export async function load({ params }) {
	const reportId = Number(params.id);
	if (!Number.isInteger(reportId)) {
		throw error(400, 'invalid report id');
	}
	const findings = await listFindingsForReport(reportId);
	return { reportId, findings };
}
