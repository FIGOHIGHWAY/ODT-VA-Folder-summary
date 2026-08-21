import * as cheerio from 'cheerio';

/** @type {Record<number, 'critical'|'high'|'medium'|'low'|'info'>} */
const RISK_NUM_TO_SEVERITY = {
	3: 'high',
	2: 'medium',
	1: 'low',
	0: 'info'
};

/** @type {Record<number, string>} */
const CONFIDENCE_NUM_TO_LABEL = {
	3: 'High',
	2: 'Medium',
	1: 'Low',
	0: 'False Positive'
};

/**
 * Parse an OWASP ZAP native HTML export into the unified finding schema.
 *
 * Matches the ZAP 2.17 report layout: `#alerts > ol > li[id^="alerts--risk-N-confidence-M"]`
 * groups findings by risk/confidence, nesting site → alert type → instance.
 * Each instance is a `<details>` containing a `table.alerts-table` of
 * label/value rows (Alert description, Solution, Parameter, Evidence, ...).
 *
 * @param {string} html
 * @param {string} sourceLabel used in error messages to identify which file failed
 * @returns {Array<object>}
 */
export function parseZapHtml(html, sourceLabel = 'zap report') {
	const $ = cheerio.load(html);

	const riskGroups = $('#alerts').find('> ol > li[id^="alerts--risk-"]');

	if (riskGroups.length === 0) {
		throw new Error(
			`parseZapHtml: ไม่พบ alert list (#alerts > ol > li[id^="alerts--risk-"]) ใน ${sourceLabel} — โครงสร้าง ZAP export อาจเปลี่ยนไป, ต้อง inspect ไฟล์จริงใหม่`
		);
	}

	/** @type {Array<object>} */
	const results = [];

	riskGroups.each((_, groupEl) => {
		const $group = $(groupEl);
		const groupId = $group.attr('id') || '';
		const idMatch = groupId.match(/alerts--risk-(\d+)-confidence-(\d+)/);
		if (!idMatch) {
			throw new Error(
				`parseZapHtml: risk group id "${groupId}" ไม่ตรงรูปแบบ "alerts--risk-N-confidence-M" ใน ${sourceLabel}`
			);
		}

		const riskNum = Number(idMatch[1]);
		const confidenceNum = Number(idMatch[2]);
		const severity = RISK_NUM_TO_SEVERITY[riskNum];
		if (!severity) {
			throw new Error(
				`parseZapHtml: risk level "${riskNum}" (จาก id "${groupId}") ไม่รู้จัก ใน ${sourceLabel}`
			);
		}
		const confidence = CONFIDENCE_NUM_TO_LABEL[confidenceNum] ?? null;

		$group
			.children('ol')
			.children('li.alerts--site-li')
			.each((_, siteEl) => {
				const $site = $(siteEl);
				const site = $site.children('h4').find('span.site').first().text().trim() || null;

				$site
					.children('ol')
					.children('li')
					.each((_, typeEl) => {
						const $type = $(typeEl);
						const alertName = $type.children('h5').find('a').first().text().trim();
						if (!alertName) {
							throw new Error(
								`parseZapHtml: พบ alert type li แต่ไม่มีชื่อ (h5 > a) ใน ${sourceLabel}`
							);
						}

						$type
							.children('ol')
							.children('li')
							.each((_, instEl) => {
								const $inst = $(instEl);
								const $table = $inst.find('table.alerts-table').first();
								if ($table.length === 0) {
									throw new Error(
										`parseZapHtml: alert "${alertName}" ไม่มี table.alerts-table ใน instance ใน ${sourceLabel}`
									);
								}

								/** @type {Record<string, string>} */
								const fields = {};
								$table.find('tr').each((_, rowEl) => {
									const $row = $(rowEl);
									const label = $row.children('th').first().text().trim();
									if (!label) return;
									fields[label] = $row.children('td').first().text().trim();
								});

								const requestSummary = $inst
									.find('summary .request-method-n-url')
									.first()
									.text()
									.trim();
								const urlMatch = requestSummary.match(/^\S+\s+(\S+)/);
								const url = urlMatch ? urlMatch[1] : null;

								results.push({
									source_tool: 'zap',
									target: site,
									identifier: alertName,
									title: alertName,
									severity,
									description: fields['Alert description'] || '',
									solution: fields['Solution'] || '',
									cvss_score: null,
									cve: null,
									affected_url_or_port: url || fields['Parameter'] || '',
									confidence,
									raw_evidence: $.html($table) ?? ''
								});
							});
					});
			});
	});

	if (results.length === 0) {
		throw new Error(
			`parseZapHtml: parse #alerts สำเร็จแต่ไม่พบ finding ใดเลย ใน ${sourceLabel} — โครงสร้างอาจเปลี่ยนไป`
		);
	}

	return results;
}
