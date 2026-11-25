import { json } from '@sveltejs/kit';
import { startScan } from '$lib/server/zap.js';
import { insertScanJob } from '$lib/server/db.js';
import { finalizeZap } from '$lib/server/scanFinalize.js';
import { canUpload } from '$lib/server/permissions.js';
import { isIpv4, extractHost } from '$lib/hostRegistry.js';
import { parseZapTargets } from '$lib/scanTargets.js';

export async function POST({ request, locals }) {
	if (!canUpload(locals.user?.role ?? 'user')) {
		return json({ error: 'ไม่มีสิทธิ์สั่งสแกน' }, { status: 403 });
	}

	const { targets, pinIp } = await request.json();
	if (!String(targets ?? '').trim()) {
		return json({ error: 'ต้องระบุ URL เป้าหมาย' }, { status: 400 });
	}

	// Each line is a URL, or "URL IP" to pin that URL's host to a server.
	const { urls, pins, errors } = parseZapTargets(targets);
	if (errors.length > 0) {
		return json({ error: errors.join('\n') }, { status: 400 });
	}
	if (urls.length === 0) {
		return json({ error: 'ต้องระบุ URL เป้าหมาย' }, { status: 400 });
	}

	// Legacy single-pin field: pins the one host in the list to this IP.
	const legacyPin = String(pinIp ?? '').trim() || null;
	if (legacyPin) {
		if (!isIpv4(legacyPin)) {
			return json({ error: `IP สำหรับปัก DNS ไม่ถูกต้อง: "${legacyPin}"` }, { status: 400 });
		}
		const hosts = [...new Set(urls.map(extractHost).filter(Boolean))];
		if (hosts.length !== 1) {
			return json({ error: 'ช่องปัก DNS แบบเดิมใช้ได้กับ 1 เว็บ — ใส่ "URL IP" ในแต่ละบรรทัดแทน' }, { status: 400 });
		}
		if (!pins.some((p) => p.host === hosts[0])) pins.push({ host: hosts[0], ip: legacyPin });
	}

	const target = urls.join(', ');
	const extra = pins.length > 0 ? pins.map((p) => `${p.host}→${p.ip}`).join(', ') : null;

	try {
		// The scan_jobs row is inserted after startScan returns its id, so the
		// finalizer waits for it — a scan that fails instantly would otherwise
		// update a row that doesn't exist yet and leave it stuck at "running".
		let markRowReady;
		const rowReady = new Promise((resolve) => (markRowReady = resolve));
		const jobId = startScan(urls, pins, async (id, outcome) => {
			await rowReady;
			return finalizeZap(id, outcome);
		});
		await insertScanJob({
			tool: 'zap',
			target,
			externalId: jobId,
			extra,
			createdBy: locals.user?.email ?? locals.user?.name ?? null
		}).finally(markRowReady);
		return json({ jobId });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return json({ error: message }, { status: 502 });
	}
}
