import { redirect } from '@sveltejs/kit';
import { rpConfig } from '$lib/server/webauthn.js';

/** Only allow a local, single-leading-slash return path. */
function safeReturnTo(raw) {
	if (typeof raw === 'string' && /^\/(?!\/)/.test(raw)) return raw;
	return '/';
}

export async function load({ locals, url }) {
	// hooks.server.js guarantees a logged-in user here; if MFA is already done,
	// there's nothing to do on this page.
	const returnTo = safeReturnTo(url.searchParams.get('returnTo'));
	if (!locals.user) throw redirect(302, `/login?returnTo=${encodeURIComponent('/mfa')}`);
	if (locals.user.mfaStatus === 'verified') throw redirect(302, returnTo);

	return {
		mfaStatus: locals.user.mfaStatus,
		email: locals.user.email,
		rpId: rpConfig().rpID,
		returnTo
	};
}
