import { json } from '@sveltejs/kit';
import { getScanStatus } from '$lib/server/zap.js';
import { canUpload } from '$lib/server/permissions.js';

// Reporting only: results are imported and scan_jobs updated server-side the
// moment a scan settles (see lib/server/scanFinalize.js), not by this poll.
export async function GET({ params, locals }) {
	if (!canUpload(locals.user?.role ?? 'user')) {
		return json({ error: 'ไม่มีสิทธิ์เข้าถึง' }, { status: 403 });
	}

	const job = getScanStatus(params.id);

	if (job.status === 'not_found') {
		return json({ error: 'ไม่พบงานสแกนนี้' }, { status: 404 });
	}
	if (job.status === 'running') {
		return json({
			status: 'running',
			phase: job.phase,
			progress: job.progress,
			percent: job.percent,
			imported: false
		});
	}
	if (job.status === 'error') {
		return json({ status: 'error', imported: false, error: job.error });
	}
	return json({ status: 'done', imported: true, ...job.result });
}
