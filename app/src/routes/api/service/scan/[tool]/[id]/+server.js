import { json } from '@sveltejs/kit';
import { getServiceScan } from '$lib/server/serviceScan.js';

// Service API: a scan's state, with findings once done (auth in hooks.server.js).
export async function GET({ params, locals }) {
	try {
		const r = await getServiceScan(params.tool, params.id, locals.service);
		if (!r) return json({ error: 'ไม่พบงานสแกนนี้' }, { status: 404 });
		return json(r);
	} catch (err) {
		return json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
	}
}
