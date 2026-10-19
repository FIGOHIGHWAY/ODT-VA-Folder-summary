import { json } from '@sveltejs/kit';
import { setFindingTriage, clearFindingTriage, TRIAGE_STATUSES } from '$lib/server/db.js';
import { canUpload } from '$lib/server/permissions.js';

/** @returns {{ domain: string, titleKey: string } | null} */
function readKey(body) {
	const domain = typeof body?.domain === 'string' ? body.domain.trim() : '';
	const titleKey = typeof body?.titleKey === 'string' ? body.titleKey.trim() : '';
	return domain && titleKey ? { domain, titleKey } : null;
}

// Set a triage decision for a domain + finding title (applies to later scan rounds too).
export async function POST({ request, locals }) {
	if (!canUpload(locals.user?.role ?? 'user')) {
		return json({ error: 'ไม่มีสิทธิ์ตรวจสอบ finding' }, { status: 403 });
	}
	const body = await request.json().catch(() => null);
	const key = readKey(body);
	if (!key) return json({ error: 'ต้องระบุ domain และ titleKey' }, { status: 400 });
	if (!TRIAGE_STATUSES.includes(body.status)) {
		return json({ error: 'สถานะไม่ถูกต้อง' }, { status: 400 });
	}
	const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
	if (body.status !== 'confirmed' && !reason) {
		return json({ error: 'ต้องระบุเหตุผล' }, { status: 400 });
	}

	const triage = await setFindingTriage({
		...key,
		status: body.status,
		reason: reason || null,
		decidedBy: locals.user?.email ?? null
	});
	return json({ ...key, triage });
}

// Undo a decision: the findings go back to "not yet reviewed".
export async function DELETE({ request, locals }) {
	if (!canUpload(locals.user?.role ?? 'user')) {
		return json({ error: 'ไม่มีสิทธิ์ตรวจสอบ finding' }, { status: 403 });
	}
	const key = readKey(await request.json().catch(() => null));
	if (!key) return json({ error: 'ต้องระบุ domain และ titleKey' }, { status: 400 });

	await clearFindingTriage(key.domain, key.titleKey);
	return json({
		...key,
		triage: { triage_status: null, triage_reason: null, triage_by: null, triage_at: null }
	});
}
