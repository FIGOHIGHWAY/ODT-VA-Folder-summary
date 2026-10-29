import { json, error } from '@sveltejs/kit';
import { getFindingDetail } from '$lib/server/db.js';

/**
 * Full detail of one finding (description, solution, raw_evidence, …), loaded
 * lazily when a row is expanded on the report page — the list endpoint omits
 * these heavy columns so a report with tens of thousands of findings doesn't
 * ship tens of MB to the browser at once.
 */
export async function GET({ params, locals }) {
	if (!locals.user) {
		throw error(401, 'ต้องเข้าสู่ระบบ');
	}
	const id = Number(params.id);
	if (!Number.isInteger(id)) {
		throw error(400, 'invalid finding id');
	}
	const finding = await getFindingDetail(id);
	if (!finding) {
		throw error(404, 'finding not found');
	}
	return json({ finding });
}
