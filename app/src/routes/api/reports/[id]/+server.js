import { json, error } from '@sveltejs/kit';
import { deleteReport } from '$lib/server/db.js';
import { canDelete } from '$lib/server/permissions.js';

export async function DELETE({ params, locals }) {
	if (!canDelete(locals.user?.role ?? 'user')) {
		return json({ error: 'ไม่มีสิทธิ์ลบ report' }, { status: 403 });
	}

	const reportId = Number(params.id);
	if (!Number.isInteger(reportId)) {
		throw error(400, 'invalid report id');
	}

	const result = await deleteReport(reportId);
	if (!result.deleted) {
		return json({ error: `ไม่พบ report #${reportId}` }, { status: 404 });
	}

	return json({ ok: true, domain: result.domain, originalFilename: result.originalFilename });
}
