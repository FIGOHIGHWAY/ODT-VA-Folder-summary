import { redirect } from '@sveltejs/kit';
import { deleteSession, SESSION_COOKIE } from '$lib/server/session.js';
import { buildLogoutUrl, isOauthConfigured } from '$lib/server/oauth.js';

export async function GET({ cookies }) {
	const sessionId = cookies.get(SESSION_COOKIE);
	if (sessionId) {
		await deleteSession(sessionId);
		cookies.delete(SESSION_COOKIE, { path: '/' });
	}
	// End the KKU-wide SSO session too, not just this app's — KKU redirects
	// back to whatever "Redirect Logout URL" was registered when the App ID
	// was issued (not something we control from here).
	throw redirect(302, isOauthConfigured() ? buildLogoutUrl() : '/login');
}
