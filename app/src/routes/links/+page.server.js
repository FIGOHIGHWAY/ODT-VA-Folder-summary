import { error, fail } from '@sveltejs/kit';
import { listAllActiveShareLinks, revokeShareLinkByToken } from '$lib/server/db.js';
import { canManageSettings } from '$lib/server/permissions.js';

export async function load({ locals }) {
	if (!canManageSettings(locals.user?.role ?? 'user')) {
		throw error(403, 'ไม่มีสิทธิ์เข้าถึงหน้านี้');
	}
	const links = await listAllActiveShareLinks();
	return { links };
}

export const actions = {
	revoke: async ({ request, locals }) => {
		if (!canManageSettings(locals.user?.role ?? 'user')) {
			return fail(403, { error: 'ไม่มีสิทธิ์ยกเลิกลิงก์' });
		}
		const form = await request.formData();
		const token = String(form.get('token') ?? '').trim();
		if (!token) {
			return fail(400, { error: 'ต้องระบุ token' });
		}
		await revokeShareLinkByToken(token);
		return { success: true };
	}
};
