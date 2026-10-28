import { redirect } from '@sveltejs/kit';
import { listHostRegistry } from '$lib/server/db.js';
import { canUpload } from '$lib/server/permissions.js';

export async function load({ locals }) {
	if (!canUpload(locals.user?.role ?? 'user')) {
		throw redirect(303, '/');
	}
	return { hosts: await listHostRegistry() };
}
