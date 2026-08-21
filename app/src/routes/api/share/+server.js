import { json } from '@sveltejs/kit';
import { createShareLink, getActiveShareLink, revokeShareLinksForDomain } from '$lib/server/db.js';

export async function POST({ request, locals }) {
	const { domain } = await request.json();
	if (!domain || typeof domain !== 'string') {
		return json({ error: 'ต้องระบุ domain' }, { status: 400 });
	}

	const existing = await getActiveShareLink(domain);
	const link = existing ?? (await createShareLink({ domain, createdBy: locals.user?.email ?? null }));

	return json({ token: link.token, path: `/share/${link.token}` });
}

export async function DELETE({ request }) {
	const { domain } = await request.json();
	if (!domain || typeof domain !== 'string') {
		return json({ error: 'ต้องระบุ domain' }, { status: 400 });
	}

	await revokeShareLinksForDomain(domain);
	return json({ ok: true });
}
