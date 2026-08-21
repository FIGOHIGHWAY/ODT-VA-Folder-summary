import {
	listAllowedUsers,
	addAllowedUser,
	removeAllowedUser,
	setAllowedUserRole
} from '$lib/server/db.js';
import { isValidRole } from '$lib/server/permissions.js';

export async function load() {
	const users = await listAllowedUsers();
	return { users };
}

export const actions = {
	add: async ({ request, locals }) => {
		const form = await request.formData();
		const email = String(form.get('email') ?? '').trim();
		const note = String(form.get('note') ?? '').trim() || null;
		const role = String(form.get('role') ?? 'user').trim();
		if (!email || !email.includes('@')) {
			return { error: 'ต้องระบุอีเมลที่ถูกต้อง' };
		}
		if (!isValidRole(role)) {
			return { error: 'สิทธิ์ไม่ถูกต้อง' };
		}
		await addAllowedUser({ email, note, role, addedBy: locals.user?.email ?? null });
		return { success: true };
	},
	setRole: async ({ request }) => {
		const form = await request.formData();
		const email = String(form.get('email') ?? '').trim();
		const role = String(form.get('role') ?? '').trim();
		if (!email || !isValidRole(role)) {
			return { error: 'ข้อมูลไม่ถูกต้อง' };
		}
		await setAllowedUserRole(email, role);
		return { success: true, roleChanged: true };
	},
	remove: async ({ request }) => {
		const form = await request.formData();
		const email = String(form.get('email') ?? '').trim();
		if (!email) {
			return { error: 'ต้องระบุอีเมล' };
		}
		await removeAllowedUser(email);
		return { success: true, removed: true };
	}
};
