import { json } from '@sveltejs/kit';
import { buildRegistrationOptions } from '$lib/server/webauthn.js';
import { setSessionChallenge, SESSION_COOKIE } from '$lib/server/session.js';

// Start enrolling a passkey: return creation options and stash the challenge on
// the session so the matching verify step can check it. Reachable by any
// logged-in user (enrolling the first passkey, or adding another later).
export async function POST({ locals, cookies }) {
	if (!locals.user) return json({ error: 'unauthorized' }, { status: 401 });
	const options = await buildRegistrationOptions(locals.user);
	await setSessionChallenge(cookies.get(SESSION_COOKIE), options.challenge);
	return json(options);
}
