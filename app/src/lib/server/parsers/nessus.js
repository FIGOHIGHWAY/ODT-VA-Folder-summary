import * as cheerio from 'cheerio';

/** @type {Record<string, 'critical'|'high'|'medium'|'low'|'info'>} */
const COLOR_TO_SEVERITY = {
	'#91243E': 'critical',
	'#DD4B50': 'high',
	'#F18C43': 'medium',
	'#F8C851': 'low',
	'#67ACE1': 'info'
};

/**
 * Parse a Tenable Nessus native HTML export into the unified finding schema.
 * @param {string} html
 * @param {string} sourceLabel used in error messages to identify which file failed
 * @returns {Array<object>}
 */
export function parseNessusHtml(html, sourceLabel = 'nessus report') {
	const $ = cheerio.load(html);

	let target = null;
	$('div').each((_, el) => {
		if (target) return;
		const style = ($(el).attr('style') || '').replace(/\s/g, '').toLowerCase();
		if (style.includes('font-size:22px') && style.includes('font-weight:700')) {
			target = $(el).text().trim();
		}
	});
	if (!target) {
		throw new Error(
			`parseNessusHtml: ไม่พบ target hostname (div font-size:22px;font-weight:700) ใน ${sourceLabel}`
		);
	}

	const findingDivs = $('div').filter((_, el) => {
		const id = $(el).attr('id') || '';
		if (!id || id.endsWith('-container')) return false;
		const style = $(el).attr('style') || '';
		return /background\s*:\s*#[0-9a-fA-F]{6}/.test(style);
	});

	if (findingDivs.length === 0) {
		throw new Error(
			`parseNessusHtml: ไม่พบ finding div ที่มี id + inline background color ใน ${sourceLabel} — โครงสร้างอาจเปลี่ยนไป`
		);
	}

	/** @type {Array<object>} */
	const results = [];

	findingDivs.each((_, el) => {
		const $div = $(el);
		const id = $div.attr('id') ?? '';
		const style = $div.attr('style') || '';
		const colorMatch = style.match(/background\s*:\s*(#[0-9a-fA-F]{6})/);
		const color = colorMatch ? colorMatch[1].toUpperCase() : null;
		const severity = color ? COLOR_TO_SEVERITY[color] : undefined;
		if (!severity) {
			throw new Error(
				`parseNessusHtml: สีที่ไม่รู้จัก "${color}" บน div#${id} ใน ${sourceLabel} — ต้องอัพเดท color mapping`
			);
		}

		// Read only the finding div's own direct text nodes: real exports nest a
		// "toggle" indicator div (e.g. "+"/"-") inside the same element, and a
		// plain .text() call would pull that in and corrupt the title.
		const titleText = $div
			.contents()
			.filter((_, node) => node.type === 'text')
			.text()
			.trim();
		const m = titleText.match(/^(\S+)\s*-\s*(.+)$/);
		if (!m) {
			throw new Error(
				`parseNessusHtml: title "${titleText}" ของ div#${id} ไม่ตรงรูปแบบ "{plugin_id} - {plugin_name}" ใน ${sourceLabel}`
			);
		}
		const [, pluginId, pluginName] = m;

		// Look up the container as the immediate next sibling rather than by id
		// selector: finding ids can repeat (e.g. the same plugin on multiple
		// ports), and an id-based lookup would always resolve to the first
		// container in the document instead of the one paired with this finding.
		const container = $div.next(`#${cssEscape(id)}-container`);
		if (container.length === 0) {
			throw new Error(
				`parseNessusHtml: ไม่พบ container "#${id}-container" คู่กับ div#${id} ใน ${sourceLabel} (คาดว่าเป็น sibling ถัดไปทันที)`
			);
		}

		/** @type {Record<string, string>} */
		const details = {};
		container.find('.details-header').each((_, header) => {
			const label = $(header).text().trim();
			const content = $(header).next();
			details[label] = content.length ? content.text().trim() : '';
		});

		const cvssRaw = details['CVSS v3.0 Base Score'] ?? details['CVSS v2.0 Base Score'] ?? null;
		const cvssScore = cvssRaw != null ? parseFloat(cvssRaw) : null;

		results.push({
			source_tool: 'nessus',
			target,
			identifier: pluginId,
			title: pluginName.trim(),
			severity,
			description: details['Description'] || '',
			solution: details['Solution'] || '',
			cvss_score: Number.isFinite(cvssScore) ? cvssScore : null,
			cve: details['CVE'] || null,
			affected_url_or_port: target,
			raw_evidence: ($.html(el) ?? '') + ($.html(container) ?? '')
		});
	});

	return results;
}

/** @param {string} id */
function cssEscape(id) {
	return id.replace(/([^\w-])/g, '\\$1');
}
