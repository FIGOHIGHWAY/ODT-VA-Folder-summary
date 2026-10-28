import { error } from '@sveltejs/kit';
import { listFindingsBySeverityAndDomain, listHostRegistry } from '$lib/server/db.js';
import { canUpload } from '$lib/server/permissions.js';

const VALID_SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];

export async function load({ params, locals }) {
	if (!VALID_SEVERITIES.includes(params.severity)) {
		throw error(400, 'invalid severity');
	}
	const [findings, hosts] = await Promise.all([
		listFindingsBySeverityAndDomain(params.severity, params.domain),
		listHostRegistry()
	]);
	return {
		severity: params.severity,
		domain: params.domain,
		findings,
		hosts,
		canTriage: canUpload(locals.user?.role ?? 'user')
	};
}
