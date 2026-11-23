import { json } from '@sveltejs/kit';
import { buildAuthenticationOptions } from '$lib/server/webauthn.js';
import { setSessionChallenge, SESSION_COOKIE } from '$lib/server/session.js';

// Start asserting an existing passkey (the second factor at login): return
// request options and stash the challenge on the session.
export async function POST({ locals, cookies }) {
	if (!locals.user) return json({ error: 'unauthorized' }, { status: 401 });
	const options = await buildAuthenticationOptions(locals.user.sub);
	await setSessionChallenge(cookies.get(SESSION_COOKIE), options.challenge);
	return json(options);
}
