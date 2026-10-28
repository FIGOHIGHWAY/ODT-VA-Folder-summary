import { searchFindings, listHostRegistry } from '$lib/server/db.js';

export async function load({ url }) {
	const q = url.searchParams.get('q') ?? '';
	try {
		const [results, hosts] = await Promise.all([
			q.trim() ? searchFindings(q) : [],
			listHostRegistry()
		]);
		return { q, results, hosts, dbError: null };
	} catch (err) {
		return { q, results: [], hosts: [], dbError: err instanceof Error ? err.message : String(err) };
	}
}
