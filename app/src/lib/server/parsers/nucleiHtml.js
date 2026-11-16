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
 * Parse a Nuclei HTML report into the unified finding schema. Nuclei has no
 * HTML export of its own, so these are written up from its results and come
 * in two shapes, told apart by their markup:
 *
 * - a "CVE sweep" — one CVE checked across many hosts, each host a `td.ip`
 *   table row (see parseCveSweepLayout);
 * - a "vulnerability list" — many findings, each a `tr.r` row listing its
 *   affected hosts as `a.host` links (see parseVulnListLayout).
 *
 * Both produce one finding per (vulnerability, host) pair, so the import
 * layer files them one report per host.
 *
 * @param {string} html
 * @param {string} sourceLabel used in error messages to identify which file failed
 * @returns {Array<object>}
 */
export function parseNucleiHtml(html, sourceLabel = 'nuclei report') {
	const $ = cheerio.load(html);
	if ($('td.ip').length > 0) return parseCveSweepLayout($, sourceLabel);
	if ($('tr.r').length > 0 || $('a.host').length > 0) return parseVulnListLayout($, sourceLabel);
	throw new Error(
		`parseNucleiHtml: ไม่รู้จักโครงสร้างรายงาน Nuclei ใน ${sourceLabel} (ไม่พบทั้งตาราง td.ip และแถว tr.r / a.host)`
	);
}

/**
 * CVE sweep layout — one CVE across many hosts, each in a `td.ip` row:
 * - rows with a green `.b-ok` badge are hosts checked and NOT affected, so
 *   they are skipped;
 * - a host can appear in several tables, so the first (richest) row per IP
 *   wins;
 * - a row with a version `.chip` but no risk badge is a version-only match,
 *   kept as "tentative" so triage flags it for review.
 * CVE, title, severity and CVSS come from the header; the fix from the
 * "สิ่งที่ต้องทำ" / "มาตรการชั่วคราว" notes.
 * @param {import('cheerio').CheerioAPI} $
 * @param {string} sourceLabel
 */
function parseCveSweepLayout($, sourceLabel) {
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

/** Strip a leading Thai label like "ผลกระทบ:" from a detail line. */
function stripLabel(text) {
	return text.replace(/^[^:：]{0,40}[:：]\s*/, '').trim();
}

/** The hostname of an <a> — from its href if parseable, else its link text. */
function hostOf($a) {
	const href = $a.attr('href');
	if (href) {
		try {
			return new URL(href).hostname.toLowerCase();
		} catch {
			/* fall through to the link text */
		}
	}
	// Link text can carry a trailing "●" marking a newly-found host.
	return clean($a.text()).replace(/\s*●\s*$/, '').toLowerCase();
}

/**
 * Vulnerability-list layout — many findings, each a `tr.r` summary row
 * (severity badge, template id in `<code>`, name in `.nm`, CVSS/EPSS `.num`
 * cells, affected hosts as `a.host` links) followed by a `tr.d` detail row
 * (impact `.imp`, fix `.fix`, references `.refs`). Emits one finding per
 * (vulnerability, host). These reports are version-based (readme.txt) and
 * say so, so every finding is "tentative" to make triage flag it.
 * @param {import('cheerio').CheerioAPI} $
 * @param {string} sourceLabel
 */
function parseVulnListLayout($, sourceLabel) {
	/** @type {Array<object>} */
	const results = [];

	$('tr.r').each((_, rowEl) => {
		const $row = $(rowEl);
		const badgeClass = $row.find('span.badge').attr('class') ?? '';
		const severity = SEVERITIES.find((s) => badgeClass.split(/\s+/).includes(s)) ?? 'info';

		const identifier = clean($row.find('code').first().text()) || 'unknown';
		const name = clean($row.find('.nm').first().text());
		const title = name || identifier;
		const cve = identifier.match(CVE_PATTERN)?.[0]?.toUpperCase() ?? null;

		const cvssText = clean($row.find('.num').first().text());
		const cvss = /^\d/.test(cvssText) ? Number(cvssText) : null;

		const $detail = $row.nextAll('tr.d').first();
		const impact = stripLabel(clean($detail.find('.imp').text()));
		const fix = stripLabel(clean($detail.find('.fix').text())) || null;
		const refs = $detail
			.find('.refs a')
			.map((_, a) => $(a).attr('href'))
			.get()
			.filter(Boolean);

		$row.find('.hosts a').each((_, a) => {
			const $a = $(a);
			const host = hostOf($a);
			if (!host) return;
			const isNew = $a.hasClass('new');
			const description = [
				impact,
				isNew && 'พบเพิ่มในการสแกนรอบที่ 2',
				refs.length > 0 && `อ้างอิง: ${refs.join(' ')}`
			]
				.filter(Boolean)
				.join('\n');

			results.push({
				source_tool: 'nuclei',
				target: host,
				identifier,
				title,
				severity,
				description,
				solution: fix,
				cvss_score: cvss,
				cve,
				affected_url_or_port: `https://${host}`,
				confidence: 'tentative',
				raw_evidence: `${$.html($row)}\n${$.html($detail)}`
			});
		});
	});

	if (results.length === 0) {
		throw new Error(
			`parseNucleiHtml: ไม่พบรายการช่องโหว่ (แถว tr.r ที่มีโฮสต์) ใน ${sourceLabel}`
		);
	}
	return results;
}
