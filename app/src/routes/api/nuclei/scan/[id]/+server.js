import { json } from '@sveltejs/kit';
import { cancelScan } from '$lib/server/nuclei.js';
import { updateScanJobByExternalId } from '$lib/server/db.js';
import { canUpload } from '$lib/server/permissions.js';

export async function DELETE({ params, locals }) {
	if (!canUpload(locals.user?.role ?? 'user')) {
		return json({ error: 'ไม่มีสิทธิ์ยกเลิกสแกน' }, { status: 403 });
	}
	const jobId = params.id;
	const cancelled = cancelScan(jobId);
	// Even if the job isn't tracked in memory anymore (e.g. the server
	// restarted since it was launched, so the real process can't be
	// reached), still clear its "running" status — it can't be un-stuck
	// otherwise, and the underlying process has likely already ended too.
	await updateScanJobByExternalId('nuclei', jobId, {
		status: 'error',
		errorMessage: cancelled ? 'ยกเลิกโดยผู้ใช้' : 'ยกเลิกโดยผู้ใช้ (server รีสตาร์ทไปแล้ว ไม่สามารถหยุด process จริงได้)'
	});
	return json({ cancelled });
}
