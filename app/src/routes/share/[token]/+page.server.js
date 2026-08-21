import { error } from '@sveltejs/kit';
import { resolveShareToken, listFindingsForDomain, listReportsForDomain } from '$lib/server/db.js';

export async function load({ params }) {
	const domain = await resolveShareToken(params.token);
	if (!domain) {
		throw error(404, 'ลิงก์แชร์นี้ไม่ถูกต้อง หรือถูกยกเลิกไปแล้ว');
	}

	const [findings, reports] = await Promise.all([
		listFindingsForDomain(domain),
		listReportsForDomain(domain)
	]);

	return { domain, findings, reports };
}
