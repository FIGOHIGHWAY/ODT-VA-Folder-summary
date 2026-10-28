import { json } from '@sveltejs/kit';
import { listHostRegistry, upsertHostEntry } from '$lib/server/db.js';
import { canUpload } from '$lib/server/permissions.js';
import { isIpv4 } from '$lib/hostRegistry.js';

export async function GET({ locals }) {
	if (!canUpload(locals.user?.role ?? 'user')) {
		return json({ error: 'ไม่มีสิทธิ์เข้าถึง' }, { status: 403 });
	}
	return json({ hosts: await listHostRegistry() });
}

export async function POST({ request, locals }) {
	if (!canUpload(locals.user?.role ?? 'user')) {
		return json({ error: 'ไม่มีสิทธิ์เข้าถึง' }, { status: 403 });
	}
	const body = await request.json().catch(() => null);
	const ip = String(body?.ip ?? '').trim().toLowerCase();
	const label = String(body?.label ?? '').trim();
	const hostname = String(body?.hostname ?? '').trim().toLowerCase() || null;
	const note = String(body?.note ?? '').trim() || null;
	if (!isIpv4(ip)) {
		return json({ error: 'ต้องระบุ IP (IPv4) ให้ถูกต้อง เช่น 10.1.1.10' }, { status: 400 });
	}
	if (!label) {
		return json({ error: 'ต้องระบุชื่อ/คำอธิบายของเครื่อง (label)' }, { status: 400 });
	}

	try {
		const id = await upsertHostEntry({
			ip,
			hostname,
			label,
			note,
			savedBy: locals.user?.email ?? locals.user?.name ?? null
		});
		return json({ id });
	} catch (err) {
		return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
	}
}
