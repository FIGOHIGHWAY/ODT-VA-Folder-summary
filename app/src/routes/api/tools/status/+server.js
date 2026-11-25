import { json } from '@sveltejs/kit';
import { canUpload } from '$lib/server/permissions.js';
import { getToolStatuses } from '$lib/server/toolStatus.js';

// Mirrors NESSUS_SCAN_ENABLED on the scan page: the Nessus license has
// scan_api turned off, so scans can only be imported, not started.
const NESSUS_SCAN_ENABLED = false;

/** GET /api/tools/status[?refresh=1] — health of each scanner VM. */
export async function GET({ url, locals }) {
	if (!canUpload(locals.user?.role ?? 'user')) {
		return json({ error: 'ไม่มีสิทธิ์' }, { status: 403 });
	}
	const force = url.searchParams.get('refresh') === '1';
	return json(await getToolStatuses({ force, nessusScanEnabled: NESSUS_SCAN_ENABLED }));
}
