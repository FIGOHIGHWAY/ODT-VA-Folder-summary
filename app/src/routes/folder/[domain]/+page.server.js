import { error } from '@sveltejs/kit';
import {
	listReportsForDomain,
	getActiveShareLinks,
	getAiSummary,
	getUserAiKey
} from '$lib/server/db.js';
import { canGenerateReport } from '$lib/server/permissions.js';

export async function load({ params, locals }) {
	const domain = params.domain;
	if (!domain || domain === 'unknown') {
		throw error(404, 'ไม่พบ domain นี้');
	}

	const reports = await listReportsForDomain(domain);
	if (reports.length === 0) {
		throw error(404, `ไม่พบรายงานของ domain "${domain}"`);
	}

	const email = locals.user?.email;
	const [shareLinks, aiSummary, userAiKey] = await Promise.all([
		getActiveShareLinks(domain),
		getAiSummary(domain),
		email ? getUserAiKey(email) : null
	]);

	return {
		domain,
		reports,
		shareLinks,
		aiSummary,
		hasOwnAiKey: Boolean(userAiKey),
		canGenerateReport: canGenerateReport(locals.user?.role ?? 'user')
	};
}
