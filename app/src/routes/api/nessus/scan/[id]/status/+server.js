import { json } from '@sveltejs/kit';
import { getScanStatus, exportScanHtml } from '$lib/server/nessus.js';
import { parseAndInsert } from '$lib/server/importReport.js';
import { canUpload } from '$lib/server/permissions.js';

// Nessus scan status values: pending, running, completed, canceled, aborted, imported
const DONE = new Set(['completed', 'imported']);
const FAILED = new Set(['canceled', 'aborted']);

export async function GET({ params, locals }) {
	if (!canUpload(locals.user?.role ?? 'user')) {
		return json({ error: 'ไม่มีสิทธิ์เข้าถึง' }, { status: 403 });
	}

	const scanId = Number(params.id);
	if (!Number.isFinite(scanId)) {
		return json({ error: 'scan id ไม่ถูกต้อง' }, { status: 400 });
	}

	try {
		const { status } = await getScanStatus(scanId);

		if (FAILED.has(status)) {
			return json({ status, imported: false });
		}
		if (!DONE.has(status)) {
			return json({ status, imported: false });
		}

		const html = await exportScanHtml(scanId);
		const result = await parseAndInsert(`nessus-scan-${scanId}.html`, html);
		return json({ status, imported: true, ...result });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return json({ error: message }, { status: 502 });
	}
}
