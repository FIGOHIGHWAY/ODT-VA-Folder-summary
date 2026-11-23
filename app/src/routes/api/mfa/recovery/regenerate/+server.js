import { json } from '@sveltejs/kit';
import { regenerateRecoveryCodes } from '$lib/server/webauthn.js';

// Replace the user's recovery codes with a fresh set (invalidating the old
// ones). Returned once for the user to save. Verified sessions only.
export async function POST({ locals }) {
	if (!locals.user || locals.user.mfaStatus !== 'verified') {
		return json({ error: 'unauthorized' }, { status: 401 });
	}
	const recoveryCodes = await regenerateRecoveryCodes(locals.user.sub);
	return json({ recoveryCodes });
}
