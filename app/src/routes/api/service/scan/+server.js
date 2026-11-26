import { json } from '@sveltejs/kit';
import { startServiceScan, ServiceInputError } from '$lib/server/serviceScan.js';

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
		console.log(
			`[service] ${locals.service} สั่งสแกน ${r.tool} ${r.jobId} (${(body.targets ?? []).length} target${body.cveId ? ' · ' + body.cveId : ''})`
		);
		return json(r);
	} catch (err) {
		if (err instanceof ServiceInputError) return json({ error: err.message }, { status: err.status });
		// Internal failures (SSH, scanner APIs) stay in our log; the caller gets
		// a generic message rather than our hosts, paths or stack details.
		console.error(`[service] ${locals.service} สั่งสแกนไม่สำเร็จ:`, err);
		return json({ error: 'ระบบสแกนขัดข้อง ลองใหม่ภายหลัง หรือแจ้งทีม VA Scan' }, { status: 502 });
	}
}
