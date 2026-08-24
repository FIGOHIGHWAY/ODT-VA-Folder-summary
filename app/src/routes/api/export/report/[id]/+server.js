import { error } from '@sveltejs/kit';
import { listFindingsForReport } from '$lib/server/db.js';
import { findingsToPdf } from '$lib/server/pdf.js';

export async function GET({ params }) {
	const reportId = Number(params.id);
	if (!Number.isInteger(reportId)) {
		throw error(400, 'invalid report id');
	}
	const findings = await listFindingsForReport(reportId);
	if (findings.length === 0) {
		throw error(404, `ไม่พบ finding ของ report #${reportId}`);
	}
	const pdf = await findingsToPdf(findings, {
		title: `VA Scan Findings — Report #${reportId}`,
		subtitle: `${findings.length} finding(s) - generated ${new Date().toISOString()}`
	});
	return new Response(pdf, {
		headers: {
			'Content-Type': 'application/pdf',
			'Content-Disposition': `attachment; filename="report-${reportId}-findings.pdf"`
		}
	});
}
