import {
	getDashboardSummary,
	getYearlyBreakdown,
	getTopDomainsByFindingCount
} from '$lib/server/db.js';

export async function load() {
	try {
		const [summary, yearly, topDomains] = await Promise.all([
			getDashboardSummary(),
			getYearlyBreakdown(),
			getTopDomainsByFindingCount(5)
		]);
		return { summary, yearly, topDomains, dbError: null };
	} catch (err) {
		return {
			summary: null,
			yearly: [],
			topDomains: [],
			dbError: err instanceof Error ? err.message : String(err)
		};
	}
}
