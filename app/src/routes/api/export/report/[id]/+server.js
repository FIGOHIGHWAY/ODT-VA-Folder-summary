import { error } from '@sveltejs/kit';
import { listFindingsForReport, getReportMeta } from '$lib/server/db.js';
import { buildNetworkSummary } from '$lib/server/cidr.js';
import { findingsToPdf } from '$lib/server/pdf.js';

export async function GET({ params }) {
	const reportId = Number(params.id);
	if (!Number.isInteger(reportId)) {
		throw error(400, 'invalid report id');
	}
	const [findings, meta] = await Promise.all([
		listFindingsForReport(reportId),
		getReportMeta(reportId)
	]);
	if (!meta) {
		throw error(404, `ไม่พบ report #${reportId}`);
	}
	const networkSummary = meta.scan_target ? buildNetworkSummary(meta.scan_target, findings) : null;
	const pdf = await findingsToPdf(findings, {
		title: `VA Scan Findings — Report #${reportId}`,
		subtitle: `${findings.length} finding(s) - generated ${new Date().toISOString()}`,
		networkSummary
	});
	return new Response(pdf, {
		headers: {
			'Content-Type': 'application/pdf',
			'Content-Disposition': `attachment; filename="report-${reportId}-findings.pdf"`
		}
	});
}
