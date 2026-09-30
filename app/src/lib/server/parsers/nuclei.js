/** @type {Record<string, 'critical'|'high'|'medium'|'low'|'info'>} */
const SEVERITY_MAP = {
	critical: 'critical',
	high: 'high',
	medium: 'medium',
	low: 'low',
	info: 'info',
	unknown: 'info'
};

/**
 * Parse Nuclei's `-jsonl` output (one JSON object per line, one per finding)
 * into the unified finding schema.
 * @param {string} jsonl
 * @param {string} sourceLabel used in error messages to identify which scan failed
 * @returns {Array<object>}
 */
export function parseNucleiJsonl(jsonl, sourceLabel = 'nuclei scan') {
	const lines = jsonl
		.split('\n')
		.map((l) => l.trim())
		.filter(Boolean);

	// No lines means nuclei ran cleanly and simply found nothing — not a
	// failure — so this returns an empty finding list rather than throwing.

	/** @type {Array<object>} */
	const results = [];

	for (const line of lines) {
		let entry;
		try {
			entry = JSON.parse(line);
		} catch {
			throw new Error(`parseNucleiJsonl: บรรทัด JSON ไม่ถูกต้องใน ${sourceLabel}: ${line.slice(0, 200)}`);
		}

		const info = entry.info ?? {};
		const severity = SEVERITY_MAP[(info.severity ?? 'info').toLowerCase()] ?? 'info';
		const cve = (info.classification?.['cve-id'] ?? [])[0] ?? null;
		const cvssScore = info.classification?.['cvss-score'] ?? null;

		results.push({
			source_tool: 'nuclei',
			target: entry.host ?? entry['matched-at'] ?? 'unknown',
			identifier: entry['template-id'] ?? entry.templateID ?? 'unknown',
			title: info.name ?? entry['template-id'] ?? 'Unknown finding',
			severity,
			description: info.description ?? '',
			solution: (info.remediation ?? '') || '',
			cvss_score: typeof cvssScore === 'number' ? cvssScore : null,
			cve,
			affected_url_or_port: entry['matched-at'] ?? entry.host ?? '',
			raw_evidence: JSON.stringify(entry, null, 2)
		});
	}

	return results;
}
