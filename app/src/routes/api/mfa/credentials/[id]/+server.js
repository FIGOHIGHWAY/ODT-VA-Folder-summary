import { json } from '@sveltejs/kit';
import { deleteCredential, renameCredential } from '$lib/server/webauthn.js';

// Manage one of the signed-in user's own passkeys. Only a fully MFA-verified
// session may change credentials (a half-authenticated session must finish MFA
// first, so it can't strip its own factors).
function verified(locals) {
	return locals.user && locals.user.mfaStatus === 'verified';
}

export async function DELETE({ locals, params }) {
	if (!verified(locals)) return json({ error: 'unauthorized' }, { status: 401 });
	const deleted = await deleteCredential(locals.user.sub, params.id);
	return json({ deleted });
}

export async function PATCH({ locals, params, request }) {
	if (!verified(locals)) return json({ error: 'unauthorized' }, { status: 401 });
	const { name } = await request.json();
	if (!name || typeof name !== 'string') {
		return json({ error: 'ต้องระบุชื่อ' }, { status: 400 });
	}
	const renamed = await renameCredential(locals.user.sub, params.id, name);
	return json({ renamed });
}
