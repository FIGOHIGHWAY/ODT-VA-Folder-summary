import { redirect, error } from '@sveltejs/kit';
import { buildAuthorizeUrl, isOauthConfigured } from '$lib/server/oauth.js';

const RETURN_TO_COOKIE = 'oauth_return_to';

/** Only ever follow an internal relative path — never an open redirect. */
function sanitizeReturnTo(value) {
	if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
	return value;
}

export async function GET({ cookies, url }) {
	if (!isOauthConfigured()) {
		throw error(
			500,
			'KKU SSO ยังไม่ได้ตั้งค่า: ต้องกำหนด OAUTH_ISSUER, OAUTH_APP_ID, OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET, OAUTH_REDIRECT_URI'
		);
	}

	// KKU SSONext's login endpoint doesn't round-trip a state/CSRF param, so
	// there's nothing to store beyond where to send the user back afterwards.
	cookies.set(RETURN_TO_COOKIE, sanitizeReturnTo(url.searchParams.get('returnTo')), {
		path: '/',
		httpOnly: true,
		secure: url.protocol === 'https:',
		sameSite: 'lax',
		maxAge: 600 // 10 minutes — just long enough for the SSO round trip
	});

	throw redirect(302, buildAuthorizeUrl());
}
