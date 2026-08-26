import { json, error } from '@sveltejs/kit';
import { getDomainCountsBySeverity } from '$lib/server/db.js';

const VALID_SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];

export async function GET({ params }) {
	if (!VALID_SEVERITIES.includes(params.severity)) {
		throw error(400, 'invalid severity');
	}
	const domains = await getDomainCountsBySeverity(params.severity);
	return json({ severity: params.severity, domains });
}
