import { json } from '@sveltejs/kit';
import { verifyRegistration, regenerateRecoveryCodes } from '$lib/server/webauthn.js';
import {
	getSession,
	setSessionChallenge,
	markSessionMfaVerified,
	SESSION_COOKIE
} from '$lib/server/session.js';

// Finish enrolling a passkey. On the user's FIRST passkey this also completes
// MFA for the session and issues one-time recovery codes (returned once, shown
// to the user, only hashes kept). Adding a further passkey from the account
// page just stores it.
export async function POST({ locals, cookies, request }) {
	if (!locals.user) return json({ error: 'unauthorized' }, { status: 401 });
	const sessionId = cookies.get(SESSION_COOKIE);
	const session = await getSession(sessionId);
	if (!session?.webauthn_challenge) {
		return json({ error: 'ไม่พบ challenge — เริ่มลงทะเบียนใหม่' }, { status: 400 });
	}

	const { response, deviceName } = await request.json();
	let result;
	try {
		result = await verifyRegistration({
			sub: locals.user.sub,
			deviceName,
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

	let recoveryCodes = null;
	if (session.mfa_status === 'pending_enroll') {
		recoveryCodes = await regenerateRecoveryCodes(locals.user.sub);
		await markSessionMfaVerified(sessionId);
	}
	return json({ verified: true, recoveryCodes });
}
