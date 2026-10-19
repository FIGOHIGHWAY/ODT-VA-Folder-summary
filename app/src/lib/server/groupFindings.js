const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

/** Same normalization as findings.title_key (case and punctuation ignored). */
function titleKeyOf(f) {
	return (
		f.title_key ??
		String(f.title ?? '')
			.toLowerCase()
			.replace(/[\s\p{P}\p{S}]+/gu, ' ')
			.trim()
	);
}

/**
 * Collapse findings that share a title into one entry per vulnerability, so
 * a report lists "CSP header not set — 40 places" once instead of 40 rows.
 * Each group keeps its most severe level, every distinct target, CVE and
 * the highest CVSS. Sorted most severe first, then by how often it occurs.
 * @param {Array<object>} findings
 * @returns {Array<{ title: string, severity: string, count: number, targets: string[],
 *   cves: string[], cvss_score: number|null, solution: string|null, source_tools: string[] }>}
 */
export function groupFindingsByTitle(findings) {
	/** @type {Map<string, any>} */
	const groups = new Map();
	for (const f of findings) {
		const key = titleKeyOf(f);
		let g = groups.get(key);
		if (!g) {
			g = {
				title: f.title,
				severity: f.severity,
				count: 0,
				targets: new Set(),
				cves: new Set(),
				cvss_score: null,
				solution: null,
				source_tools: new Set()
			};
			groups.set(key, g);
		}
		g.count += 1;
		if ((SEVERITY_RANK[f.severity] ?? 5) < (SEVERITY_RANK[g.severity] ?? 5)) g.severity = f.severity;
		const target = f.affected_url_or_port || f.target;
		if (target) g.targets.add(String(target));
		for (const cve of String(f.cve ?? '').split(/[\s,]+/)) if (cve) g.cves.add(cve);
		const cvss = f.cvss_score == null ? null : Number(f.cvss_score);
		if (cvss != null && !Number.isNaN(cvss) && (g.cvss_score == null || cvss > g.cvss_score)) g.cvss_score = cvss;
		if (!g.solution && f.solution) g.solution = f.solution;
		if (f.source_tool) g.source_tools.add(f.source_tool);
	}

	return [...groups.values()]
		.map((g) => ({
			...g,
			targets: [...g.targets],
			cves: [...g.cves],
			source_tools: [...g.source_tools]
		}))
		.sort(
			(a, b) =>
				(SEVERITY_RANK[a.severity] ?? 5) - (SEVERITY_RANK[b.severity] ?? 5) ||
				b.count - a.count ||
				a.title.localeCompare(b.title)
		);
}
