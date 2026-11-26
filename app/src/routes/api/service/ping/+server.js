import { json } from '@sveltejs/kit';
import { SERVICE_TOOLS, MAX_SERVICE_TARGETS } from '$lib/server/serviceScan.js';

// Service API: lets a caller check its token and the tools it can use.
export function GET({ locals }) {
	return json({ ok: true, caller: locals.service, tools: SERVICE_TOOLS, maxTargets: MAX_SERVICE_TARGETS });
}
