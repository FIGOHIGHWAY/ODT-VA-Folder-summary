import { json } from '@sveltejs/kit';
import { startScan } from '$lib/server/nuclei.js';
import { insertScanJob } from '$lib/server/db.js';
import { finalizeNuclei } from '$lib/server/scanFinalize.js';
import { expandTargetList, summarizeResolvedTargets } from '$lib/server/cidr.js';
import { canUpload } from '$lib/server/permissions.js';
import { isValidHostname } from '$lib/hostRegistry.js';
import { parseNucleiTargets } from '$lib/scanTargets.js';

export async function POST({ request, locals }) {
	if (!canUpload(locals.user?.role ?? 'user')) {
		return json({ error: 'ไม่มีสิทธิ์สั่งสแกน' }, { status: 403 });
	}

	const { targets, cveId, hostHeader } = await request.json();
	if (!String(targets ?? '').trim()) {
		return json({ error: 'ต้องระบุ target (IP หรือโดเมน)' }, { status: 400 });
	}
	const trimmedCve = String(cveId ?? '').trim() || null;
	// Default Host header for lines that don't carry their own "IP name" pair.
	const defaultHost = String(hostHeader ?? '').trim().toLowerCase() || null;
	if (defaultHost && !isValidHostname(defaultHost)) {
		return json({ error: `Host header ไม่ถูกต้อง: "${defaultHost}"` }, { status: 400 });
	}

	const { groups, targets: flatTargets, errors } = parseNucleiTargets(targets, defaultHost);
	if (errors.length > 0) {
		return json({ error: errors.join('\n') }, { status: 400 });
	}
	if (flatTargets.length === 0) {
		return json({ error: 'ต้องระบุ target (IP หรือโดเมน)' }, { status: 400 });
	}

	const headers = groups.map((g) => g.hostHeader).filter(Boolean);
	const hostLabel =
		headers.length === 0 ? null : headers.length === 1 ? `Host: ${headers[0]}` : `Host: ${headers.length} ชื่อ`;
	const extra = [trimmedCve, hostLabel].filter(Boolean).join(' · ') || null;
	const target =
		headers.length > 1
			? groups.map((g) => (g.hostHeader ? `${g.targets.join(', ')} (${g.hostHeader})` : g.targets.join(', '))).join(', ')
			: flatTargets.join(', ');

	let resolvedTargets = null;
	try {
		resolvedTargets = summarizeResolvedTargets(expandTargetList(flatTargets.join(', ')));
	} catch (err) {
		return json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
	}

	try {
		// The scan_jobs row is inserted after startScan returns its id, so the
		// finalizer waits for it — a scan that fails instantly would otherwise
		// update a row that doesn't exist yet and leave it stuck at "running".
		let markRowReady;
		const rowReady = new Promise((resolve) => (markRowReady = resolve));
		const jobId = startScan(groups, trimmedCve, async (id, outcome) => {
			await rowReady;
			return finalizeNuclei(id, outcome);
		});
		await insertScanJob({
			tool: 'nuclei',
			target,
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
