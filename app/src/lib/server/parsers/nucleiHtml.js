import * as cheerio from 'cheerio';

const CVE_PATTERN = /CVE-\d{4}-\d{4,}/i;
const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];
const HOSTNAME_PATTERN = /^(?=.*[a-z])[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
const CIDR_PATTERN = /\d+\.\d+\.\d+\.\d+\/\d+/;
const PROTOCOL_PATTERN = /^https?$/i;

/** Collapse whitespace so cell/note text reads as one clean line. */
function clean(text) {
	return text.replace(/\s+/g, ' ').trim();
}

/**
 * Parse a Nuclei CVE sweep report — an HTML summary of one CVE checked across
 * many hosts (Nuclei itself has no HTML export; these are written up from its
 * results). Each affected host is a table row with a `td.ip` cell:
 *
 * - rows carrying a green `.b-ok` badge are hosts checked and found NOT
 *   affected, so they are skipped;
 * - a host can appear in several tables (e.g. the action list and an HTTP/2
 *   check), so the first row per IP wins — the action list comes first and
 *   carries the richest evidence;
 * - a row with a version `.chip` but no badge is a version-only match, kept
 *   with confidence "tentative" so the triage view flags it for review.
 *
 * The CVE, title, severity and CVSS come from the report header; the fix
 * comes from the "สิ่งที่ต้องทำ" / "มาตรการชั่วคราว" notes.
 *
 * @param {string} html
 * @param {string} sourceLabel used in error messages to identify which file failed
 * @returns {Array<object>} one finding per affected host
 */
export function parseNucleiHtml(html, sourceLabel = 'nuclei report') {
	const $ = cheerio.load(html);
	const headerText = clean($('header').first().text() || $('h1').first().text());
	const bodyText = clean($('body').text());

	const cve = (headerText.match(CVE_PATTERN) || $('title').text().match(CVE_PATTERN))?.[0]?.toUpperCase();
	if (!cve) {
		throw new Error(`parseNucleiHtml: ไม่พบหมายเลข CVE ในหัวรายงาน ${sourceLabel}`);
	}

	const subtitle = clean($('header .sub').first().text());
	const title = subtitle ? `${cve}: ${subtitle}` : clean($('h1').first().text()) || cve;
	const tagText = clean($('header .tag').text()).toLowerCase();
	const severity = SEVERITIES.find((s) => tagText.includes(s)) ?? 'high';
	const cvssMatch = bodyText.match(/CVSS\s*(?:v?3(?:\.\d)?\s*)?[:\s]\s*(\d{1,2}(?:\.\d)?)/i);
	const cvss = cvssMatch ? Number(cvssMatch[1]) : null;

	const solution =
		$('.note')
			.toArray()
			.map((el) => clean($(el).text()))
			.filter((t) => /^(สิ่งที่ต้องทำ|มาตรการชั่วคราว)/.test(t))
			.join('\n\n') || null;

	/** @type {Map<string, object>} */
	const byIp = new Map();

	$('tr').each((_, rowEl) => {
		const $row = $(rowEl);
		const ip = clean($row.find('td.ip').first().text());
		if (!ip || byIp.has(ip) || $row.find('.b-ok').length > 0) return;

		const version = clean($row.find('.chip').first().text()) || null;
		const hasRiskBadge = $row.find('.b-crit, .b-high').length > 0;
		if (!version && !hasRiskBadge) return;

		let domain = null;
		let protocol = null;
		const evidence = [];
		$row.find('td').each((_, cellEl) => {
			const $cell = $(cellEl);
			const text = clean($cell.text());
			if (!text || $cell.is('.ip') || $cell.find('.badge, .chip').length > 0) return;
			if (CIDR_PATTERN.test(text)) return;
			if (PROTOCOL_PATTERN.test(text)) {
				protocol = text.toLowerCase();
			} else if (!domain && HOSTNAME_PATTERN.test(text)) {
				domain = text.toLowerCase();
			} else {
				evidence.push(text);
			}
		});

		const $panel = $row.closest('.panel');
		const section = clean($panel.prevAll('h3, h2').first().text());
		const note = clean($panel.find('.note').first().text());

		const description = [
			section && `[${section}]`,
			version && `ตรวจพบเวอร์ชัน ${version}`,
			evidence.length > 0 && evidence.join(' · '),
			note
		]
			.filter(Boolean)
			.join('\n');

		byIp.set(ip, {
			source_tool: 'nuclei',
			target: ip,
			identifier: cve,
			title,
			severity,
			description,
			solution,
			cvss_score: cvss,
			cve,
			affected_url_or_port: domain
				? `${protocol ?? 'https'}://${domain}`
				: `${protocol ?? 'https'}://${ip}`,
			confidence: hasRiskBadge ? 'firm' : 'tentative',
			raw_evidence: $.html($row)
		});
	});

	if (byIp.size === 0) {
		throw new Error(
			`parseNucleiHtml: ไม่พบแถวโฮสต์ที่ได้รับผลกระทบ (td.ip ที่ไม่ได้ติด badge "ok") ใน ${sourceLabel}`
		);
	}
	return [...byIp.values()];
}
