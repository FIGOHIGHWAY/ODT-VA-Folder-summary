import * as cheerio from 'cheerio';

/** @type {Record<string, 'critical'|'high'|'medium'|'low'|'info'>} */
const THREAT_TO_SEVERITY = {
	Critical: 'critical',
	High: 'high',
	Medium: 'medium',
	Low: 'low',
	Log: 'info'
};

/**
 * Parse a GMP get_reports XML response into the unified finding schema.
 * @param {string} xml
 * @param {string} sourceLabel used in error messages to identify which report failed
 * @returns {Array<object>}
 */
export function parseOpenvasXml(xml, sourceLabel = 'openvas report') {
	const $ = cheerio.load(xml, { xmlMode: true });

	const resultNodes = $('results > result');
	if (resultNodes.length === 0) {
		throw new Error(`parseOpenvasXml: ไม่พบ <result> ใน ${sourceLabel} — รายงานอาจยังไม่มีผล`);
	}

	/** @type {Array<object>} */
	const results = [];

	resultNodes.each((_, el) => {
		const $r = $(el);
		const threat = $r.children('threat').first().text().trim();
		const severity = THREAT_TO_SEVERITY[threat] ?? 'info';
		const name = $r.children('name').first().text().trim() || 'Unknown finding';
		const host = $r.children('host').first().text().trim();
		const port = $r.children('port').first().text().trim();
		const description = $r.children('description').first().text().trim();
		const oid = $r.children('nvt').attr('oid') ?? '';
		const cve = $r.find('nvt > cve').first().text().trim();
		const cvssRaw = $r.children('severity').first().text().trim();
		const cvssScore = cvssRaw ? parseFloat(cvssRaw) : null;

		results.push({
			source_tool: 'openvas',
			target: host || 'unknown',
			identifier: oid || name,
			title: name,
			severity,
			description,
			solution: '',
			cvss_score: Number.isFinite(cvssScore) ? cvssScore : null,
			cve: cve && cve !== 'NOCVE' ? cve : null,
			affected_url_or_port: port || host,
			raw_evidence: $.html(el) ?? ''
		});
	});

	return results;
}
