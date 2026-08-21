import * as cheerio from 'cheerio';

/**
 * Detect whether an HTML export is a Tenable Nessus or OWASP ZAP native
 * report, by looking for each tool's signature text.
 * @param {string} html
 * @param {string} sourceLabel used in error messages to identify which file failed
 * @returns {'nessus'|'zap'}
 */
export function detectReportType(html, sourceLabel = 'report') {
	const $ = cheerio.load(html);
	const headText = $('head').text();
	const title = $('title').text();
	const bodyText = $('body').text().slice(0, 5000);
	const bodyHtml = $('body').html()?.slice(0, 5000) ?? '';
	const combined = `${headText} ${title} ${bodyText} ${bodyHtml}`;

	if (/Tenable Nessus/i.test(combined)) return 'nessus';
	// ZAP rebranded itself "ZAP by Checkmarx" in newer releases and dropped the
	// "OWASP ZAP" string from the report entirely, so match on any of the
	// signatures actually seen across versions.
	if (/OWASP ZAP|ZAP by Checkmarx|zaproxy\.org/i.test(combined)) return 'zap';

	throw new Error(
		`detectReportType: ไม่พบ signature ของ Nessus ("Tenable Nessus") หรือ ZAP ("OWASP ZAP" / "ZAP by Checkmarx" / "zaproxy.org") ` +
			`ใน ${sourceLabel} — ไฟล์อาจไม่ใช่ native export ที่รองรับ หรือ version เปลี่ยน format`
	);
}
