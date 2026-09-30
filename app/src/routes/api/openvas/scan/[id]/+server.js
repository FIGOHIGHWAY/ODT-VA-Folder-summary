import { json } from '@sveltejs/kit';
import { cancelScan } from '$lib/server/openvas.js';
import { updateScanJobByExternalId } from '$lib/server/db.js';
import { canUpload } from '$lib/server/permissions.js';

export async function DELETE({ params, locals }) {
	if (!canUpload(locals.user?.role ?? 'user')) {
		return json({ error: 'ไม่มีสิทธิ์ยกเลิกสแกน' }, { status: 403 });
	}
	const taskId = params.id;
	try {
		await cancelScan(taskId);
		await updateScanJobByExternalId('openvas', taskId, {
			status: 'error',
			errorMessage: 'ยกเลิกโดยผู้ใช้'
		});
		return json({ cancelled: true });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return json({ error: message }, { status: 502 });
	}
}
