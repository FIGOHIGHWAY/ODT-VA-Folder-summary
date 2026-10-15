import {
	getDashboardSummary,
	getYearlyBreakdown,
	getTopDomainsByFindingCount,
	getTopVulnerabilities
} from '$lib/server/db.js';

export async function load() {
	try {
		const [summary, yearly, topDomains, topVulns] = await Promise.all([
			getDashboardSummary(),
			getYearlyBreakdown(),
			getTopDomainsByFindingCount(5),
			getTopVulnerabilities()
		]);
		return { summary, yearly, topDomains, topVulns, dbError: null };
	} catch (err) {
		return {
			summary: null,
			yearly: [],
			topDomains: [],
			topVulns: [],
			dbError: err instanceof Error ? err.message : String(err)
		};
	}
}
