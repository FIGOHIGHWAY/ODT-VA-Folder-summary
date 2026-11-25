import { json } from '@sveltejs/kit';
import { canUpload } from '$lib/server/permissions.js';
import { getLatest, getHistory, assess, collectOnce, THRESHOLDS, RANGES } from '$lib/server/monitor.js';

/**
 * GET /api/monitor?range=1h|24h|7d|30d[&refresh=1]
 * Latest disk/RAM/CPU per machine plus bucketed history for the charts.
 */
export async function GET({ url, locals }) {
	if (!canUpload(locals.user?.role ?? 'user')) {
		return json({ error: 'ไม่มีสิทธิ์' }, { status: 403 });
	}
	const range = RANGES.includes(url.searchParams.get('range') ?? '') ? url.searchParams.get('range') : '24h';
	if (url.searchParams.get('refresh') === '1') await collectOnce();

	let history = {};
	let historyError = null;
	try {
		history = await getHistory(range);
	} catch (e) {
		// Most likely migration 024 hasn't been applied yet.
		historyError = e instanceof Error ? e.message : String(e);
	}

	const vms = getLatest().map((v) => ({ ...v, ...assess(v.sample), series: history[v.id] ?? [] }));
	return json({ range, thresholds: THRESHOLDS, vms, historyError, now: Date.now() });
}
