import { searchFindings } from '$lib/server/db.js';

export async function load({ url }) {
	const q = url.searchParams.get('q') ?? '';
	try {
		const results = q.trim() ? await searchFindings(q) : [];
		return { q, results, dbError: null };
	} catch (err) {
		return { q, results: [], dbError: err instanceof Error ? err.message : String(err) };
	}
}
