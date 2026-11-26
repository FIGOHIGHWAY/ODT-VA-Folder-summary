import { json } from '@sveltejs/kit';
import { serviceTools, maxServiceTargets, maxServiceRunning } from '$lib/server/serviceScan.js';

// Service API: lets a caller check its token, the tools it can use and its limits.
export function GET({ locals }) {
	return json({
		ok: true,
		caller: locals.service,
		tools: serviceTools(),
		maxTargets: maxServiceTargets(),
		maxRunning: maxServiceRunning()
	});
}
