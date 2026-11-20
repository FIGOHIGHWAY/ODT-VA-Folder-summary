import {
	getDashboardSummary,
	getYearlyBreakdown,
	getTopDomainsByFindingCount,
	getTopVulnerabilities,
	getActivityBreakdown
} from '$lib/server/db.js';

export async function load() {
	try {
		const [summary, yearly, topDomains, topVulns, activity] = await Promise.all([
			getDashboardSummary(),
			getYearlyBreakdown(),
			getTopDomainsByFindingCount(5),
			getTopVulnerabilities(),
			getActivityBreakdown('month')
		]);
		return { summary, yearly, topDomains, topVulns, activity, dbError: null };
	} catch (err) {
		return {
			summary: null,
			yearly: [],
			topDomains: [],
			topVulns: [],
			activity: [],
			dbError: err instanceof Error ? err.message : String(err)
		};
	}
}
