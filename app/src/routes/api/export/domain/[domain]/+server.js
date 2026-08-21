import { error } from '@sveltejs/kit';
import { listFindingsForDomain } from '$lib/server/db.js';
import { findingsToPdf } from '$lib/server/pdf.js';

export async function GET({ params }) {
	const domain = params.domain;
	const findings = await listFindingsForDomain(domain);
	if (findings.length === 0) {
		throw error(404, `ไม่พบ finding ของ domain "${domain}"`);
	}
	const pdf = await findingsToPdf(findings, {
		title: `VA Scan Findings — ${domain}`,
		subtitle: `${findings.length} finding(s) · generated ${new Date().toISOString()}`
	});
	return new Response(pdf, {
		headers: {
			'Content-Type': 'application/pdf',
			'Content-Disposition': `attachment; filename="${domain}-findings.pdf"`
		}
	});
}
