import { json } from '@sveltejs/kit';
import { createAndLaunchScan } from '$lib/server/nessus.js';
import { canUpload } from '$lib/server/permissions.js';

export async function POST({ request, locals }) {
	if (!canUpload(locals.user?.role ?? 'user')) {
		return json({ error: 'ไม่มีสิทธิ์สั่งสแกน' }, { status: 403 });
	}

	const { targets } = await request.json();
	const trimmed = String(targets ?? '').trim();
	if (!trimmed) {
		return json({ error: 'ต้องระบุ target (IP หรือโดเมน)' }, { status: 400 });
	}

	try {
		const { scanId } = await createAndLaunchScan(`VA Scan - ${trimmed} - ${new Date().toISOString()}`, trimmed);
		return json({ scanId });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return json({ error: message }, { status: 502 });
	}
}
