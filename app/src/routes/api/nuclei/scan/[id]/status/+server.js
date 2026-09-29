import { json } from '@sveltejs/kit';
import { getScanStatus } from '$lib/server/nuclei.js';
import { parseAndInsertNuclei } from '$lib/server/importReport.js';
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
		return json({ status: 'running', imported: false });
	}
	if (job.status === 'error') {
		return json({ status: 'error', imported: false, error: job.error });
	}

	try {
		const result = await parseAndInsertNuclei(`nuclei-scan-${jobId}.jsonl`, job.output);
		return json({ status: 'done', imported: true, ...result });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return json({ error: message }, { status: 502 });
	}
}
