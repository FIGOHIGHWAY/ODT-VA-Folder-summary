import { json } from '@sveltejs/kit';
import { getServiceScan } from '$lib/server/serviceScan.js';

// Service API: a scan's state, with findings once done (auth in hooks.server.js).
export async function GET({ params, locals }) {
	try {
		const r = await getServiceScan(params.tool, params.id, locals.service);
		if (!r) return json({ error: 'ไม่พบงานสแกนนี้' }, { status: 404 });
		return json(r);
	} catch (err) {
		console.error(`[service] ${locals.service} อ่านสถานะ ${params.tool}/${params.id} ไม่สำเร็จ:`, err);
		return json({ error: 'อ่านสถานะงานสแกนไม่สำเร็จ ลองใหม่ภายหลัง' }, { status: 502 });
	}
}
