import * as cheerio from 'cheerio';

/**
 * Detect whether an HTML export is a Tenable Nessus, OWASP ZAP, or Burp
 * Suite native report, or a Nuclei CVE sweep report, by looking for each
 * tool's signature text.
 * @param {string} html
 * @param {string} sourceLabel used in error messages to identify which file failed
 * @returns {'nessus'|'zap'|'burp'|'nuclei'}
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
	if (/^Burp Scanner Report$/im.test(title)) return 'burp';
	// A Nuclei CVE sweep write-up: names Nuclei and a CVE, and lists hosts in
	// td.ip cells (see parsers/nucleiHtml.js).
	if (/\bNuclei\b/i.test(combined) && /CVE-\d{4}-\d{4,}/i.test(combined) && $('td.ip').length > 0) {
		return 'nuclei';
	}

	throw new Error(
		`detectReportType: ไม่พบ signature ของ Nessus ("Tenable Nessus"), ZAP ("OWASP ZAP" / "ZAP by Checkmarx" / "zaproxy.org"), ` +
			`Burp Suite ("Burp Scanner Report") หรือรายงาน Nuclei (คำว่า "Nuclei" + CVE + ตาราง td.ip) ใน ${sourceLabel} — ไฟล์อาจไม่ใช่ format ที่รองรับ หรือ version เปลี่ยน format`
	);
}
