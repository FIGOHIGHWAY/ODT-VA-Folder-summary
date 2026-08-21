import { detectReportType } from './detect.js';
import { parseNessusHtml } from './nessus.js';
import { parseZapHtml } from './zap.js';

export { detectReportType, parseNessusHtml, parseZapHtml };

/**
 * Detect the report type and parse it with the matching parser.
 * @param {string} html
 * @param {string} sourceLabel
 * @returns {{ type: 'nessus'|'zap', findings: Array<object> }}
 */
export function parseReport(html, sourceLabel = 'report') {
	const type = detectReportType(html, sourceLabel);
	const findings = type === 'nessus' ? parseNessusHtml(html, sourceLabel) : parseZapHtml(html, sourceLabel);
	return { type, findings };
}
