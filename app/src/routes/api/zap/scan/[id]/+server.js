import { json } from '@sveltejs/kit';
import { cancelScan } from '$lib/server/zap.js';
import { updateScanJobByExternalId } from '$lib/server/db.js';
import { canUpload } from '$lib/server/permissions.js';

export async function DELETE({ params, locals }) {
	if (!canUpload(locals.user?.role ?? 'user')) {
		return json({ error: 'ไม่มีสิทธิ์ยกเลิกสแกน' }, { status: 403 });
	}
	const jobId = params.id;
	try {
		const cancelled = await cancelScan(jobId);
		if (cancelled) {
			await updateScanJobByExternalId('zap', jobId, {
				status: 'error',
				errorMessage: 'ยกเลิกโดยผู้ใช้'
			});
		}
		return json({ cancelled });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return json({ error: message }, { status: 502 });
	}
}
