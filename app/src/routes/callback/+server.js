import { redirect, error } from '@sveltejs/kit';
import {
	exchangeCodeForToken,
	extractProfile,
	isEmailAllowedWithDb,
	resolveRole
} from '$lib/server/oauth.js';
import { createSession, SESSION_COOKIE } from '$lib/server/session.js';
import { isEmailInAllowedUsers, getAllowedUserRole } from '$lib/server/db.js';

const RETURN_TO_COOKIE = 'oauth_return_to';

export async function GET({ url, cookies }) {
	const code = url.searchParams.get('code');
	const ssoError = url.searchParams.get('error');

	if (ssoError) {
		throw error(400, `KKU SSO ปฏิเสธการเข้าสู่ระบบ: ${ssoError}`);
	}
	if (!code) {
		throw error(400, 'KKU SSO callback ไม่มี code');
	}

	let tokenResponse;
	try {
		tokenResponse = await exchangeCodeForToken({ code });
	} catch (err) {
		throw error(502, `แลก code เป็น token ไม่สำเร็จ: ${err instanceof Error ? err.message : err}`);
	}

	let profile;
	try {
		profile = extractProfile(tokenResponse);
	} catch (err) {
		throw error(502, err instanceof Error ? err.message : String(err));
	}

	if (!(await isEmailAllowedWithDb(profile.email, isEmailInAllowedUsers))) {
		throw error(
			403,
			`บัญชี ${profile.email ?? profile.sub} ไม่ได้รับอนุญาตให้เข้าใช้งานระบบนี้ — ติดต่อผู้ดูแลระบบเพื่อขอสิทธิ์`
		);
	}

	const role = await resolveRole(profile.email, getAllowedUserRole);
	const session = await createSession({ ...profile, role });

	cookies.set(SESSION_COOKIE, session.id, {
		path: '/',
		httpOnly: true,
		secure: url.protocol === 'https:',
		sameSite: 'lax',
		expires: session.expiresAt
	});

	const returnTo = cookies.get(RETURN_TO_COOKIE) || '/';
	cookies.delete(RETURN_TO_COOKIE, { path: '/' });

	throw redirect(302, returnTo);
}
