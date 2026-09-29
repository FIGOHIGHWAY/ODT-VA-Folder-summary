import { json } from '@sveltejs/kit';
import { getScanStatus, getReportXml } from '$lib/server/openvas.js';
import { parseAndInsertOpenvas } from '$lib/server/importReport.js';
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
		const { status, reportId } = await getScanStatus(taskId);

		if (FAILED.has(status)) {
			return json({ status, imported: false });
		}
		if (!DONE.has(status) || !reportId) {
			return json({ status, imported: false });
		}

		const xml = await getReportXml(reportId);
		const result = await parseAndInsertOpenvas(`openvas-scan-${taskId}.xml`, xml);
		return json({ status, imported: true, ...result });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return json({ error: message }, { status: 502 });
	}
}
