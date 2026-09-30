import { json } from '@sveltejs/kit';
import { getScanStatus, getReportXml } from '$lib/server/openvas.js';
import { parseAndInsertOpenvas } from '$lib/server/importReport.js';
import { updateScanJobByExternalId } from '$lib/server/db.js';
import { canUpload } from '$lib/server/permissions.js';

// GMP task status values: Requested, Queued, Running, Done, Stopped, Interrupted
const DONE = new Set(['Done']);
const FAILED = new Set(['Stopped', 'Interrupted']);

export async function GET({ params, locals }) {
	if (!canUpload(locals.user?.role ?? 'user')) {
		return json({ error: 'ไม่มีสิทธิ์เข้าถึง' }, { status: 403 });
	}

	const taskId = params.id;

	try {
		const { status, reportId, percent } = await getScanStatus(taskId);

		if (FAILED.has(status)) {
			await updateScanJobByExternalId('openvas', taskId, {
				status: 'error',
				errorMessage: `สแกนถูกยกเลิก (${status})`
			});
			return json({ status, imported: false });
		}
		if (!DONE.has(status) || !reportId) {
			return json({ status, percent, imported: false });
		}

		const xml = await getReportXml(reportId);
		const result = await parseAndInsertOpenvas(`openvas-scan-${taskId}.xml`, xml);
		await updateScanJobByExternalId('openvas', taskId, {
			status: 'done',
			reportId: result.reportId ?? result.existingReportId ?? null
		});
		return json({ status, imported: true, ...result });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		await updateScanJobByExternalId('openvas', taskId, { status: 'error', errorMessage: message });
		return json({ error: message }, { status: 502 });
	}
}
