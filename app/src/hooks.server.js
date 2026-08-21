import { getSession, SESSION_COOKIE } from '$lib/server/session.js';
import {
	canUpload,
	canGenerateReport,
	canManageUsers,
	canManageSettings,
	canExport
} from '$lib/server/permissions.js';

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
	const sessionId = event.cookies.get(SESSION_COOKIE);
	if (sessionId) {
		try {
			const session = await getSession(sessionId);
			event.locals.user = session
				? { sub: session.sub, name: session.name, email: session.email, role: session.role }
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
