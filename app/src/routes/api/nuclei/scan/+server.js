import { json } from '@sveltejs/kit';
import { startScan } from '$lib/server/nuclei.js';
import { insertScanJob } from '$lib/server/db.js';
import { expandTargetList, summarizeResolvedTargets } from '$lib/server/cidr.js';
import { canUpload } from '$lib/server/permissions.js';

export async function POST({ request, locals }) {
	if (!canUpload(locals.user?.role ?? 'user')) {
		return json({ error: 'ไม่มีสิทธิ์สั่งสแกน' }, { status: 403 });
	}

	const { targets, cveId } = await request.json();
	const trimmed = String(targets ?? '').trim();
	if (!trimmed) {
		return json({ error: 'ต้องระบุ target (IP หรือโดเมน)' }, { status: 400 });
	}
	const trimmedCve = String(cveId ?? '').trim() || null;

	let resolvedTargets = null;
	try {
		resolvedTargets = summarizeResolvedTargets(expandTargetList(trimmed));
	} catch (err) {
		return json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
	}

	try {
		const jobId = startScan(trimmed, trimmedCve);
		await insertScanJob({
			tool: 'nuclei',
			target: trimmed,
			externalId: jobId,
			extra: trimmedCve,
			resolvedTargets,
			createdBy: locals.user?.email ?? locals.user?.name ?? null
		});
		return json({ jobId });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return json({ error: message }, { status: 502 });
	}
}
