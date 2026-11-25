import { canUpload } from '$lib/server/permissions.js';
import { activeAlerts } from '$lib/server/monitor.js';

export async function load({ locals }) {
	// Count of machines over a resource threshold (or offline), for the
	// top-bar Monitor link. In-memory, so it costs nothing per request.
	const monitorAlerts =
		locals.user && canUpload(locals.user.role) && locals.user.mfaStatus === 'verified'
			? activeAlerts().map((a) => ({ name: a.name, state: a.state, reasons: a.reasons }))
			: [];
	return { user: locals.user, monitorAlerts };
}
