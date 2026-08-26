import * as cheerio from 'cheerio';

/** @type {Record<string, 'high'|'medium'|'low'|'info'>} */
const SEVERITY_MAP = {
	high: 'high',
	medium: 'medium',
	low: 'low',
	information: 'info'
};

/**
 * Parse a Burp Suite (Professional) native HTML export into the unified
 * finding schema.
 *
 * Each issue is a `<span class="BODH0" id="N">` heading followed by flat
 * sibling content up to the next BODH0: a `table.summary_table` (Severity /
 * Confidence / Host / Path rows — the last two `<td>` of each row are always
 * the label/value pair, regardless of whether that row also carries the
 * rowspanned icon cell) and a series of `<h2>` section headers each
 * immediately followed by a `<span class="TEXT">` body (Issue detail, Issue
 * background, Issue remediation, ...).
 *
 * @param {string} html
 * @param {string} sourceLabel used in error messages to identify which file failed
 * @returns {Array<object>}
 */
export function parseBurpHtml(html, sourceLabel = 'burp report') {
	const $ = cheerio.load(html);
	const headings = $('span.BODH0[id]');

	if (headings.length === 0) {
		throw new Error(
			`parseBurpHtml: ไม่พบ issue heading (span.BODH0) ใน ${sourceLabel} — โครงสร้าง Burp export อาจเปลี่ยนไป, ต้อง inspect ไฟล์จริงใหม่`
		);
	}

	/** @type {Array<object>} */
	const results = [];

	headings.each((_, headEl) => {
		const $head = $(headEl);
		const $titleLink = $head.find('a').first();
		const title = ($titleLink.text() || $head.text()).replace(/^\d+\.\s*/, '').trim();
		if (!title) {
			throw new Error(`parseBurpHtml: BODH0 id="${$head.attr('id')}" ไม่มีชื่อ issue ใน ${sourceLabel}`);
		}

		const href = $titleLink.attr('href') || '';
		const slugMatch = href.match(/([^/]+)\/?$/);
		const identifier = slugMatch ? slugMatch[1] : title;

		const $block = $head.nextUntil('span.BODH0');
		const $summaryTable = $block.filter('table.summary_table').first();
		if ($summaryTable.length === 0) {
			throw new Error(`parseBurpHtml: issue "${title}" ไม่มี table.summary_table ใน ${sourceLabel}`);
		}

		/** @type {Record<string, string>} */
		const fields = {};
		$summaryTable.find('tr').each((_, rowEl) => {
			const $tds = $(rowEl).find('td');
			if ($tds.length < 2) return;
			const label = $tds
				.eq($tds.length - 2)
				.text()
				.replace(/ /g, ' ')
				.replace(/:\s*$/, '')
				.trim()
				.toLowerCase();
			const value = $tds.eq($tds.length - 1).text().trim();
			if (label) fields[label] = value;
		});

		const severityRaw = (fields.severity || '').toLowerCase();
		const severity = SEVERITY_MAP[severityRaw];
		if (!severity) {
			throw new Error(
				`parseBurpHtml: severity "${fields.severity}" (issue "${title}") ไม่รู้จัก ใน ${sourceLabel}`
			);
		}

		/** @type {Record<string, string>} */
		const sections = {};
		$block.filter('h2').each((_, h2El) => {
			const $h2 = $(h2El);
			const label = $h2.text().trim();
			const $span = $h2.next('span.TEXT');
			sections[label] = $span.length ? $span.text().trim() : '';
		});

		const host = fields.host || '';
		const path = fields.path || '';

		results.push({
			source_tool: 'burp',
			target: host || null,
			identifier,
			title,
			severity,
			description: sections['Issue detail'] || '',
			solution: sections['Issue remediation'] || '',
			cvss_score: null,
			cve: null,
			affected_url_or_port: host ? `${host}${path}` : path || null,
			confidence: fields.confidence || null,
			raw_evidence: $.html($summaryTable) ?? ''
		});
	});

	if (results.length === 0) {
		throw new Error(
			`parseBurpHtml: parse BODH0 headings สำเร็จแต่ไม่พบ finding ใดเลย ใน ${sourceLabel} — โครงสร้างอาจเปลี่ยนไป`
		);
	}

	return results;
}
