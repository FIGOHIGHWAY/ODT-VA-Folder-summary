import { json } from '@sveltejs/kit';
import { listIpGroups, createIpGroup } from '$lib/server/db.js';
import { canUpload } from '$lib/server/permissions.js';

export async function GET({ locals }) {
	if (!canUpload(locals.user?.role ?? 'user')) {
		return json({ error: 'ไม่มีสิทธิ์เข้าถึง' }, { status: 403 });
	}
	const groups = await listIpGroups();
	return json({ groups });
}

export async function POST({ request, locals }) {
	if (!canUpload(locals.user?.role ?? 'user')) {
		return json({ error: 'ไม่มีสิทธิ์เข้าถึง' }, { status: 403 });
	}
	const { name, targets } = await request.json();
	const trimmedName = String(name ?? '').trim();
	const trimmedTargets = String(targets ?? '').trim();
	if (!trimmedName) {
		return json({ error: 'ต้องระบุชื่อกลุ่ม' }, { status: 400 });
	}
	if (!trimmedTargets) {
		return json({ error: 'ต้องระบุ target อย่างน้อย 1 รายการ' }, { status: 400 });
	}

	try {
		const id = await createIpGroup({
			name: trimmedName,
			targets: trimmedTargets,
			createdBy: locals.user?.email ?? locals.user?.name ?? null
		});
		return json({ id });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		const isDuplicate = message.includes('duplicate key');
		return json(
			{ error: isDuplicate ? `มีกลุ่มชื่อ "${trimmedName}" อยู่แล้ว` : message },
			{ status: isDuplicate ? 409 : 500 }
		);
	}
}
