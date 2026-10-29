import { json } from '@sveltejs/kit';
import { startScan } from '$lib/server/nuclei.js';
import { insertScanJob } from '$lib/server/db.js';
import { finalizeNuclei } from '$lib/server/scanFinalize.js';
import { expandTargetList, summarizeResolvedTargets } from '$lib/server/cidr.js';
import { canUpload } from '$lib/server/permissions.js';
import { isValidHostname } from '$lib/hostRegistry.js';

export async function POST({ request, locals }) {
	if (!canUpload(locals.user?.role ?? 'user')) {
		return json({ error: 'ไม่มีสิทธิ์สั่งสแกน' }, { status: 403 });
	}

	const { targets, cveId, hostHeader } = await request.json();
	const trimmed = String(targets ?? '').trim();
	if (!trimmed) {
		return json({ error: 'ต้องระบุ target (IP หรือโดเมน)' }, { status: 400 });
	}
	const trimmedCve = String(cveId ?? '').trim() || null;
	const trimmedHost = String(hostHeader ?? '').trim().toLowerCase() || null;
	if (trimmedHost && !isValidHostname(trimmedHost)) {
		return json({ error: `Host header ไม่ถูกต้อง: "${trimmedHost}"` }, { status: 400 });
	}
	const extra = [trimmedCve, trimmedHost ? `Host: ${trimmedHost}` : null].filter(Boolean).join(' · ') || null;

	let resolvedTargets = null;
	try {
		resolvedTargets = summarizeResolvedTargets(expandTargetList(trimmed));
	} catch (err) {
		return json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
	}

	try {
		// The scan_jobs row is inserted after startScan returns its id, so the
		// finalizer waits for it — a scan that fails instantly would otherwise
		// update a row that doesn't exist yet and leave it stuck at "running".
		let markRowReady;
		const rowReady = new Promise((resolve) => (markRowReady = resolve));
		const jobId = startScan(trimmed, trimmedCve, trimmedHost, async (id, outcome) => {
			await rowReady;
			return finalizeNuclei(id, outcome, trimmedHost);
		});
		await insertScanJob({
			tool: 'nuclei',
			target: trimmed,
			externalId: jobId,
			extra,
			resolvedTargets,
			createdBy: locals.user?.email ?? locals.user?.name ?? null
		}).finally(markRowReady);
		return json({ jobId });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return json({ error: message }, { status: 502 });
	}
}
