import { json } from '@sveltejs/kit';
import { deleteIpGroup } from '$lib/server/db.js';
import { canUpload } from '$lib/server/permissions.js';

export async function DELETE({ params, locals }) {
	if (!canUpload(locals.user?.role ?? 'user')) {
		return json({ error: 'ไม่มีสิทธิ์เข้าถึง' }, { status: 403 });
	}
	const id = Number(params.id);
	if (!Number.isFinite(id)) {
		return json({ error: 'id ไม่ถูกต้อง' }, { status: 400 });
	}
	await deleteIpGroup(id);
	return json({ success: true });
}
