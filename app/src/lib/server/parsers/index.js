import { detectReportType } from './detect.js';
import { parseNessusHtml } from './nessus.js';
import { parseZapHtml } from './zap.js';
import { parseBurpHtml } from './burp.js';

export { detectReportType, parseNessusHtml, parseZapHtml, parseBurpHtml };

const PARSERS = {
	nessus: parseNessusHtml,
	zap: parseZapHtml,
	burp: parseBurpHtml
};

/**
 * Detect the report type and parse it with the matching parser.
 * @param {string} html
 * @param {string} sourceLabel
 * @returns {{ type: 'nessus'|'zap'|'burp', findings: Array<object> }}
 */
export function parseReport(html, sourceLabel = 'report') {
	const type = detectReportType(html, sourceLabel);
	const findings = PARSERS[type](html, sourceLabel);
	return { type, findings };
}
