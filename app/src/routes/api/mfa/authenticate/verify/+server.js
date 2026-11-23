import { json } from '@sveltejs/kit';
import { verifyAuthentication } from '$lib/server/webauthn.js';
import {
	getSession,
	setSessionChallenge,
	markSessionMfaVerified,
	SESSION_COOKIE
} from '$lib/server/session.js';

// Finish the passkey assertion. On success the session clears MFA.
export async function POST({ locals, cookies, request }) {
	if (!locals.user) return json({ error: 'unauthorized' }, { status: 401 });
	const sessionId = cookies.get(SESSION_COOKIE);
	const session = await getSession(sessionId);
	if (!session?.webauthn_challenge) {
		return json({ error: 'ไม่พบ challenge — เริ่มใหม่' }, { status: 400 });
	}

	const { response } = await request.json();
	let result;
	try {
		result = await verifyAuthentication({
			sub: locals.user.sub,
			response,
			expectedChallenge: session.webauthn_challenge
		});
	} catch (err) {
		await setSessionChallenge(sessionId, null);
		return json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
	}

	await setSessionChallenge(sessionId, null);
	if (!result.verified) {
		return json({ verified: false, error: 'ยืนยัน passkey ไม่สำเร็จ' }, { status: 400 });
	}
	await markSessionMfaVerified(sessionId);
	return json({ verified: true });
}
