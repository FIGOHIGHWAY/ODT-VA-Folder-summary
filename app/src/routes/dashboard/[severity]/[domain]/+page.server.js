import { error } from '@sveltejs/kit';
import { listFindingsBySeverityAndDomain } from '$lib/server/db.js';

const VALID_SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];

export async function load({ params }) {
	if (!VALID_SEVERITIES.includes(params.severity)) {
		throw error(400, 'invalid severity');
	}
	const findings = await listFindingsBySeverityAndDomain(params.severity, params.domain);
	return { severity: params.severity, domain: params.domain, findings };
}
