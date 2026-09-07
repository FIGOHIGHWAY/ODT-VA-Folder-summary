import { error } from '@sveltejs/kit';
import {
	resolveShareToken,
	listFindingsForDomainRound,
	listReportsForDomainRound
} from '$lib/server/db.js';

export async function load({ params }) {
	const resolved = await resolveShareToken(params.token);
	if (!resolved) {
		throw error(404, 'ลิงก์แชร์นี้ไม่ถูกต้อง หรือถูกยกเลิกไปแล้ว');
	}
	const { domain, roundDate } = resolved;

	const [findings, reports] = await Promise.all([
		listFindingsForDomainRound(domain, roundDate),
		listReportsForDomainRound(domain, roundDate)
	]);

	return { domain, roundDate, findings, reports };
}
