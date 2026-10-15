import { json, error } from '@sveltejs/kit';
import { getTopVulnerabilities } from '$lib/server/db.js';

const VALID_SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];

export async function GET({ url }) {
	const severity = url.searchParams.get('severity') || null;
	if (severity && !VALID_SEVERITIES.includes(severity)) {
		throw error(400, 'invalid severity');
	}
	const vulns = await getTopVulnerabilities({ severity });
	return json({ severity, vulns });
}
