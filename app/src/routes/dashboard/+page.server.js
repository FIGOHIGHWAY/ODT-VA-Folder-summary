import { getDashboardSummary, getYearlyBreakdown } from '$lib/server/db.js';

export async function load() {
	try {
		const [summary, yearly] = await Promise.all([getDashboardSummary(), getYearlyBreakdown()]);
		return { summary, yearly, dbError: null };
	} catch (err) {
		return { summary: null, yearly: [], dbError: err instanceof Error ? err.message : String(err) };
	}
}
