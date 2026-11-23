import { json } from '@sveltejs/kit';
import { consumeRecoveryCode, countUnusedRecoveryCodes } from '$lib/server/webauthn.js';
import { getSession, markSessionMfaVerified, SESSION_COOKIE } from '$lib/server/session.js';

// Backup factor: spend a one-time recovery code instead of a passkey. Only
// valid for a session that is awaiting passkey verification (a user who has
// passkeys but can't use one right now) — not for first-time enrollment.
export async function POST({ locals, cookies, request }) {
	if (!locals.user) return json({ error: 'unauthorized' }, { status: 401 });
	const sessionId = cookies.get(SESSION_COOKIE);
	const session = await getSession(sessionId);
	if (session?.mfa_status !== 'pending_verify') {
		return json({ error: 'ใช้ recovery code ได้เฉพาะขั้นยืนยัน passkey' }, { status: 400 });
	}

	const { code } = await request.json();
	if (!code || typeof code !== 'string') {
		return json({ error: 'กรุณากรอก recovery code' }, { status: 400 });
	}

	const ok = await consumeRecoveryCode(locals.user.sub, code);
	if (!ok) {
		return json({ verified: false, error: 'recovery code ไม่ถูกต้องหรือถูกใช้ไปแล้ว' }, { status: 400 });
	}
	await markSessionMfaVerified(sessionId);
	const remaining = await countUnusedRecoveryCodes(locals.user.sub);
	return json({ verified: true, remaining });
}
