import { detectReportType } from './detect.js';
import { parseNessusHtml } from './nessus.js';
import { parseZapHtml } from './zap.js';
import { parseBurpHtml } from './burp.js';
import { parseNucleiHtml } from './nucleiHtml.js';

export { detectReportType, parseNessusHtml, parseZapHtml, parseBurpHtml, parseNucleiHtml };

const PARSERS = {
	nessus: parseNessusHtml,
	zap: parseZapHtml,
	burp: parseBurpHtml,
	nuclei: parseNucleiHtml
};

/**
 * Report types that cover many unrelated hosts in one file and so are filed
 * as one report per host (see parseAndInsert).
 */
export const PER_HOST_TYPES = new Set(['nuclei']);

/**
 * Detect the report type and parse it with the matching parser.
 * @param {string} html
 * @param {string} sourceLabel
 * @returns {{ type: 'nessus'|'zap'|'burp'|'nuclei', findings: Array<object> }}
 */
export function parseReport(html, sourceLabel = 'report') {
	const type = detectReportType(html, sourceLabel);
	const findings = PARSERS[type](html, sourceLabel);
	return { type, findings };
}
