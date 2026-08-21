import { listReportsByDomain } from '$lib/server/db.js';
import { canUpload } from '$lib/server/permissions.js';

export async function load({ locals }) {
	const role = locals.user?.role ?? 'user';
	const flags = { canUpload: canUpload(role) };

	try {
		const domains = await listReportsByDomain();
		return { domains, dbError: null, ...flags };
	} catch (err) {
		return { domains: [], dbError: err instanceof Error ? err.message : String(err), ...flags };
	}
}
