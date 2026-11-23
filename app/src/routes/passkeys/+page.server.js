import { redirect } from '@sveltejs/kit';
import { listCredentials, countUnusedRecoveryCodes } from '$lib/server/webauthn.js';

export async function load({ locals }) {
	if (!locals.user) throw redirect(302, '/login');
	const [credentials, recoveryRemaining] = await Promise.all([
		listCredentials(locals.user.sub),
		countUnusedRecoveryCodes(locals.user.sub)
	]);
	return {
		credentials: credentials.map((c) => ({
			id: c.id,
			deviceName: c.device_name,
			backedUp: c.backed_up,
			createdAt: c.created_at,
			lastUsedAt: c.last_used_at
		})),
		recoveryRemaining
	};
}
