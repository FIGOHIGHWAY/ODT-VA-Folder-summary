import { json } from '@sveltejs/kit';
import { startServiceScan } from '$lib/server/serviceScan.js';

// Service API: start a scan for another ODT system (auth in hooks.server.js).
// Body: { tool: 'nuclei'|'nessus', targets: string[], cveId?: string, label?: string }
export async function POST({ request, locals }) {
	let body;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'body ต้องเป็น JSON' }, { status: 400 });
	}
	try {
		const r = await startServiceScan(body ?? {}, locals.service);
		console.log(`[service] ${locals.service} สั่งสแกน ${r.tool} ${r.jobId} (${(body.targets ?? []).length} target${body.cveId ? ' · ' + body.cveId : ''})`);
		return json(r);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		const status = /ไม่ได้ตั้งค่า|ECONN|fetch failed|HTTP 5/.test(message) ? 502 : 400;
		return json({ error: message }, { status });
	}
}
