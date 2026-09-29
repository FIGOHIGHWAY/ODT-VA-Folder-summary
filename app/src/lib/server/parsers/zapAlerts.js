/** @type {Record<string, 'critical'|'high'|'medium'|'low'|'info'>} */
const RISK_TO_SEVERITY = {
	high: 'high',
	medium: 'medium',
	low: 'low',
	informational: 'info'
};

/**
 * Parse the JSON array returned by ZAP's `/JSON/core/view/alerts/` API
 * (live scan results, as opposed to a manually-uploaded HTML export) into
 * the unified finding schema.
 * @param {Array<object>} alerts
 * @param {string} sourceLabel used in error messages to identify which scan failed
 * @returns {Array<object>}
 */
export function parseZapAlerts(alerts, sourceLabel = 'zap scan') {
	if (!Array.isArray(alerts) || alerts.length === 0) {
		throw new Error(`parseZapAlerts: ไม่พบผลลัพธ์ใน ${sourceLabel} (ไม่มีช่องโหว่ที่ตรวจพบ หรือสแกนล้มเหลว)`);
	}

	return alerts.map((a) => {
		const severity = RISK_TO_SEVERITY[String(a.risk ?? '').toLowerCase()] ?? 'info';
		return {
			source_tool: 'zap',
			target: a.url ?? 'unknown',
			identifier: a.pluginId ?? a.alert ?? 'unknown',
			title: a.alert ?? a.name ?? 'Unknown finding',
			severity,
			description: a.description ?? '',
			solution: a.solution ?? '',
			cvss_score: null,
			cve: null,
			affected_url_or_port: a.url ?? '',
			raw_evidence: JSON.stringify(a, null, 2)
		};
	});
}
