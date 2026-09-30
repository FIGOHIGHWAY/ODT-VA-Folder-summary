import { json } from '@sveltejs/kit';
import { getScanStatus } from '$lib/server/zap.js';
import { parseAndInsertZap } from '$lib/server/importReport.js';
import { updateScanJobByExternalId } from '$lib/server/db.js';
import { canUpload } from '$lib/server/permissions.js';

export async function GET({ params, locals }) {
	if (!canUpload(locals.user?.role ?? 'user')) {
		return json({ error: 'ไม่มีสิทธิ์เข้าถึง' }, { status: 403 });
	}

	const jobId = params.id;
	const job = getScanStatus(jobId);

	if (job.status === 'not_found') {
		return json({ error: 'ไม่พบงานสแกนนี้' }, { status: 404 });
	}
	if (job.status === 'running') {
		return json({ status: 'running', phase: job.phase, progress: job.progress, imported: false });
	}
	if (job.status === 'error') {
		await updateScanJobByExternalId('zap', jobId, { status: 'error', errorMessage: job.error });
		return json({ status: 'error', imported: false, error: job.error });
	}

	try {
		const result = await parseAndInsertZap(`zap-scan-${jobId}.json`, job.alerts ?? []);
		await updateScanJobByExternalId('zap', jobId, {
			status: 'done',
			reportId: result.reportId ?? result.existingReportId ?? null
		});
		return json({ status: 'done', imported: true, ...result });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		await updateScanJobByExternalId('zap', jobId, { status: 'error', errorMessage: message });
		return json({ error: message }, { status: 502 });
	}
}
