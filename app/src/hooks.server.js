import { building, dev } from '$app/environment';
import { getSession, SESSION_COOKIE } from '$lib/server/session.js';
import { startMonitor } from '$lib/server/monitor.js';
import { authenticateService } from '$lib/server/serviceAuth.js';
import {
	canUpload,
	canGenerateReport,
	canManageUsers,
	canManageSettings,
	canExport
} from '$lib/server/permissions.js';

// Sample disk / RAM / CPU of every scanner VM and this host once a minute
// for /monitor. Prod only: dev machines have neither the keys nor the VMs.
if (!building && !dev) startMonitor();

// Paths reachable without being logged in: the SSO round trip itself, and
// build/static assets (the client JS/CSS bundle, favicon, etc).
const PUBLIC_PATH_PREFIXES = ['/login', '/callback', '/logout', '/share', '/_app', '/favicon'];

function isPublicPath(pathname) {
	return PUBLIC_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

// Routes gated by role, beyond the base "must be logged in" check. Checked
// in order; the first matching prefix decides.
const ROLE_GATES = [
	{ prefix: '/api/parse', allowed: canUpload },
	{ prefix: '/api/summarize', allowed: canGenerateReport },
	{ prefix: '/api/export', allowed: canExport },
	{ prefix: '/users', allowed: canManageUsers },
	{ prefix: '/settings', allowed: canManageSettings }
];

function findRoleGate(pathname) {
	return ROLE_GATES.find((g) => pathname === g.prefix || pathname.startsWith(g.prefix + '/'));
}

/** @type {import('@sveltejs/kit').Handle} */
export async function handle({ event, resolve }) {
	// Service API (other ODT systems, e.g. soct.kku.ac.th): token + source IP
	// only, never a browser session — see lib/server/serviceAuth.js.
	if (event.url.pathname.startsWith('/api/service/')) {
		const auth = authenticateService(
			event.request.headers.get('authorization'),
			event.request.headers.get('x-forwarded-for')
		);
		if (!auth.ok) {
			return new Response(JSON.stringify({ error: auth.error }), {
				status: auth.status,
				headers: { 'Content-Type': 'application/json' }
			});
		}
		event.locals.user = {
			sub: `svc:${auth.name}`,
			name: `${auth.name} (service)`,
			email: `svc:${auth.name}`,
			role: 'soc',
			mfaStatus: 'verified'
		};
		event.locals.service = auth.name;
		return resolve(event);
	}

	const sessionId = event.cookies.get(SESSION_COOKIE);
	if (sessionId) {
		try {
			const session = await getSession(sessionId);
			event.locals.user = session
				? {
						sub: session.sub,
						name: session.name,
						email: session.email,
						role: session.role,
						mfaStatus: session.mfa_status
					}
				: null;
		} catch {
			// DB unreachable — treat as logged out rather than failing the request.
			event.locals.user = null;
		}
	} else {
		event.locals.user = null;
	}

	const { pathname, search } = event.url;

	if (!event.locals.user && !isPublicPath(pathname)) {
		if (pathname.startsWith('/api/')) {
			return new Response(JSON.stringify({ error: 'ต้องเข้าสู่ระบบด้วย KKU SSO ก่อนใช้งาน' }), {
				status: 401,
				headers: { 'Content-Type': 'application/json' }
			});
		}
		const returnTo = encodeURIComponent(pathname + search);
		return new Response(null, {
			status: 302,
			headers: { location: `/login?returnTo=${returnTo}` }
		});
	}

	// Logged in via SSO but not yet through MFA: confine the session to the MFA
	// flow (and logout) until it clears. Everything else bounces to /mfa, and
	// APIs get 401 — so no gated route or data is reachable on a half-auth
	// session. The /mfa page and its APIs are the only app routes allowed here.
	if (event.locals.user && event.locals.user.mfaStatus && event.locals.user.mfaStatus !== 'verified') {
		const mfaAllowed =
			pathname === '/mfa' ||
			pathname.startsWith('/api/mfa/') ||
			pathname === '/logout' ||
			isPublicPath(pathname);
		if (!mfaAllowed) {
			if (pathname.startsWith('/api/')) {
				return new Response(JSON.stringify({ error: 'ต้องยืนยันตัวตนขั้นที่สอง (MFA) ก่อน' }), {
					status: 401,
					headers: { 'Content-Type': 'application/json' }
				});
			}
			const returnTo = encodeURIComponent(pathname + search);
			return new Response(null, { status: 302, headers: { location: `/mfa?returnTo=${returnTo}` } });
		}
	}

	const gate = findRoleGate(pathname);
	if (gate && event.locals.user && !gate.allowed(event.locals.user.role)) {
		if (pathname.startsWith('/api/')) {
			return new Response(JSON.stringify({ error: 'ไม่มีสิทธิ์ใช้งานส่วนนี้' }), {
				status: 403,
				headers: { 'Content-Type': 'application/json' }
			});
		}
		return new Response('ไม่มีสิทธิ์เข้าถึงหน้านี้', { status: 403 });
	}

	return resolve(event);
}
