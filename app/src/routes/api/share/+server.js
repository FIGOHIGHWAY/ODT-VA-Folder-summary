import { json } from '@sveltejs/kit';
import {
	createShareLink,
	getActiveShareLinkForRound,
	revokeShareLinkForRound
} from '$lib/server/db.js';

export async function POST({ request, locals }) {
	const { domain, roundDate = null } = await request.json();
	if (!domain || typeof domain !== 'string') {
		return json({ error: 'ต้องระบุ domain' }, { status: 400 });
	}

	const existing = await getActiveShareLinkForRound(domain, roundDate);
	const link =
		existing ??
		(await createShareLink({ domain, roundDate, createdBy: locals.user?.email ?? null }));

	return json({ token: link.token, path: `/share/${link.token}`, roundDate: link.round_date });
}

export async function DELETE({ request }) {
	const { domain, roundDate = null } = await request.json();
	if (!domain || typeof domain !== 'string') {
		return json({ error: 'ต้องระบุ domain' }, { status: 400 });
	}

	await revokeShareLinkForRound(domain, roundDate);
	return json({ ok: true });
}
