import { env } from '$env/dynamic/private';

/**
 * KKU SSONext — per the official "KKU Single Sign On" integration guide:
 *
 *   Login endpoint (browser redirect, no other query params — the redirect
 *   URL is registered server-side by KKU when the App ID/Client ID/Secret
 *   were issued, not passed by us):
 *     GET {LOGIN_BASE}/login?app={AppID}
 *
 *   Token exchange (REST, server-to-server):
 *     POST {OAUTH_ISSUER}                 e.g. https://ssonext-api.kku.ac.th/auth.token
 *     Content-Type: application/json
 *     { "code": ..., "redirectUrl": ..., "clientId": ..., "clientSecret": ... }
 *     -> 200 { "ok": true, "accessToken": ..., "email": ..., "citizenId": ...,
 *              "firstName": ..., "lastName": ..., "employeeId": ... }
 *     -> 200 { "ok": false, "error": "AUTH0001" }   (still HTTP 200 on failure)
 *
 *   Logout endpoint (browser redirect):
 *     GET {LOGIN_BASE}/logout?app={AppID}
 *
 * There is no `state`/CSRF param in this protocol — KKU doesn't round-trip
 * one, so we don't rely on it. UAT and production are entirely separate
 * host pairs (confirmed against a working UAT-integrated app's config):
 *   - production: web/login https://ssonext.kku.ac.th     · api https://ssonext-api.kku.ac.th
 *   - UAT:        web/login https://sso-uat-web.kku.ac.th · api https://sso-uat-api.kku.ac.th
 * OAUTH_LOGIN_BASE must be the web host matching whichever api host
 * OAUTH_ISSUER points at — mixing a UAT credential with the production
 * login host (or vice versa) fails with "Cannot find the CREDENTIAL ...".
 */

const LOGIN_BASE = env.OAUTH_LOGIN_BASE ?? 'https://ssonext.kku.ac.th';
const TOKEN_URL = env.OAUTH_ISSUER ?? '';
const APP_ID = env.OAUTH_APP_ID ?? '';
const CLIENT_ID = env.OAUTH_CLIENT_ID ?? '';
const CLIENT_SECRET = env.OAUTH_CLIENT_SECRET ?? '';
const REDIRECT_URI = env.OAUTH_REDIRECT_URI ?? '';

const ALLOWED_EMAILS = (env.ALLOWED_EMAILS ?? '')
	.split(',')
	.map((e) => e.trim().toLowerCase())
	.filter(Boolean);

export function isOauthConfigured() {
	return Boolean(TOKEN_URL && APP_ID && CLIENT_ID && CLIENT_SECRET && REDIRECT_URI);
}

/** The hostname the browser gets redirected to for login (for display on the /login page). */
export function getLoginHost() {
	try {
		return new URL(LOGIN_BASE).host;
	} catch {
		return LOGIN_BASE;
	}
}

/**
 * Check a logged-in user's email against the ALLOWED_EMAILS allowlist. An
 * empty allowlist means everyone who can authenticate via KKU SSO is let in.
 * @param {string|null} email
 */
export function isEmailAllowed(email) {
	if (ALLOWED_EMAILS.length === 0) return true;
	if (!email) return false;
	return ALLOWED_EMAILS.includes(email.trim().toLowerCase());
}

/**
 * Same allowlist check as {@link isEmailAllowed}, but also consults the
 * DB-managed allowlist (see `/users`) — an email is let in if it matches
 * either. An empty env allowlist still means everyone is let in, same as
 * before, without needing a DB lookup.
 * @param {string|null} email
 * @param {(email: string) => Promise<boolean>} isEmailInAllowedUsers
 */
export async function isEmailAllowedWithDb(email, isEmailInAllowedUsers) {
	if (ALLOWED_EMAILS.length === 0) return true;
	if (!email) return false;
	if (ALLOWED_EMAILS.includes(email.trim().toLowerCase())) return true;
	return isEmailInAllowedUsers(email);
}

/**
 * Resolve a logged-in email's role: emails from the ALLOWED_EMAILS env var
 * are always 'admin' (that var is only ever set by whoever deploys the app),
 * DB-managed allowlist entries use their stored role, and anything else
 * (only reachable when the env allowlist is empty, i.e. open to anyone who
 * can authenticate) defaults to the least-privileged 'user'.
 * @param {string|null} email
 * @param {(email: string) => Promise<string|null>} getAllowedUserRole
 * @returns {Promise<'admin'|'soc'|'user'>}
 */
export async function resolveRole(email, getAllowedUserRole) {
	if (email && ALLOWED_EMAILS.includes(email.trim().toLowerCase())) return 'admin';
	if (!email) return 'user';
	const role = await getAllowedUserRole(email);
	return role ?? 'user';
}

/** The KKU SSONext login page to redirect the browser to. */
export function buildAuthorizeUrl() {
	const url = new URL('/login', LOGIN_BASE);
	url.searchParams.set('app', APP_ID);
	return url.toString();
}

/** The KKU SSONext logout page — ends the SSO-wide session, not just this app's. */
export function buildLogoutUrl() {
	const url = new URL('/logout', LOGIN_BASE);
	url.searchParams.set('app', APP_ID);
	return url.toString();
}

/**
 * Exchange an authorization code for a token + profile, using the exact
 * JSON body shape from KKU's docs: { code, redirectUrl, clientId, clientSecret }.
 * @param {{ code: string }} params
 * @returns {Promise<Record<string, any>>} the raw `{ ok: true, ... }` response
 */
export async function exchangeCodeForToken({ code }) {
	const res = await fetch(TOKEN_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			code,
			redirectUrl: REDIRECT_URI,
			clientId: CLIENT_ID,
			clientSecret: CLIENT_SECRET
		})
	});

	const bodyText = await res.text();
	let body;
	try {
		body = JSON.parse(bodyText);
	} catch {
		body = null;
	}

	if (!res.ok) {
		throw new Error(`KKU SSO token exchange failed (${res.status}): ${bodyText.slice(0, 800)}`);
	}
	if (!body) {
		throw new Error(`KKU SSO token exchange returned non-JSON response: ${bodyText.slice(0, 800)}`);
	}
	// Documented failure shape is still HTTP 200: { ok: false, error: "AUTH0001" }.
	if (body.ok === false) {
		throw new Error(`KKU SSO token exchange rejected: ${body.error ?? bodyText.slice(0, 800)}`);
	}
	return body;
}

/**
 * Map the documented auth.token success fields to our session shape.
 * @param {Record<string, any>} tokenResponse
 * @returns {{ sub: string, name: string|null, email: string|null }}
 */
export function extractProfile(tokenResponse) {
	const email = tokenResponse.email ?? null;
	const employeeId = tokenResponse.employeeId ?? null;
	const citizenId = tokenResponse.citizenId ?? null;

	const sub = email ?? employeeId ?? citizenId;
	if (!sub) {
		throw new Error(
			`KKU SSO token response ไม่มี email/employeeId/citizenId ให้ใช้เป็น user id — raw response: ${JSON.stringify(
				tokenResponse
			).slice(0, 800)}`
		);
	}

	const name = [tokenResponse.firstName, tokenResponse.lastName].filter(Boolean).join(' ') || null;

	return { sub: String(sub), name, email };
}
