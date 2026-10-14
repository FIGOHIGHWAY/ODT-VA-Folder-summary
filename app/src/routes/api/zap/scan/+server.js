import { json } from '@sveltejs/kit';
import { startScan } from '$lib/server/zap.js';
import { insertScanJob } from '$lib/server/db.js';
import { finalizeZap } from '$lib/server/scanFinalize.js';
import { canUpload } from '$lib/server/permissions.js';

export async function POST({ request, locals }) {
	if (!canUpload(locals.user?.role ?? 'user')) {
		return json({ error: 'ไม่มีสิทธิ์สั่งสแกน' }, { status: 403 });
	}

	const { targets } = await request.json();
	const trimmed = String(targets ?? '').trim();
	if (!trimmed) {
		return json({ error: 'ต้องระบุ URL เป้าหมาย' }, { status: 400 });
	}
	const urlList = trimmed
		.split(/[\n,]+/)
		.map((t) => t.trim())
		.filter(Boolean);
	const badUrl = urlList.find((u) => !/^https?:\/\//i.test(u));
	if (badUrl) {
		return json(
			{ error: `ZAP ต้องการ URL เต็มรูปแบบสำหรับทุกรายการ เช่น https://example.kku.ac.th (ผิดที่: "${badUrl}")` },
			{ status: 400 }
		);
	}

	try {
		// The scan_jobs row is inserted after startScan returns its id, so the
		// finalizer waits for it — a scan that fails instantly would otherwise
		// update a row that doesn't exist yet and leave it stuck at "running".
		let markRowReady;
		const rowReady = new Promise((resolve) => (markRowReady = resolve));
		const jobId = startScan(trimmed, async (id, outcome) => {
			await rowReady;
			return finalizeZap(id, outcome);
		});
		await insertScanJob({
			tool: 'zap',
			target: trimmed,
			externalId: jobId,
			createdBy: locals.user?.email ?? locals.user?.name ?? null
		}).finally(markRowReady);
		return json({ jobId });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return json({ error: message }, { status: 502 });
	}
}
