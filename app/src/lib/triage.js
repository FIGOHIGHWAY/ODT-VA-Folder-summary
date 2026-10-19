/** Shared by server and browser: triage labels and the "needs review" heuristic. */

export const TRIAGE_LABEL = {
	confirmed: 'ยืนยันแล้ว',
	false_positive: 'False Positive',
	accepted_risk: 'ยอมรับความเสี่ยง'
};

/** Scanner confidence levels that mean "the tool itself isn't sure". */
const LOW_CONFIDENCE = new Set(['low', 'tentative']);

// Nessus/OpenVAS plugins named like "PHP 8.0.x < 8.0.30" or "prior to 4.8.6"
// decide from the advertised version alone; distros that backport fixes
// (Ubuntu, RHEL) keep the old version number, so these are often false.
const VERSION_ONLY = /\s<\s*\d|\bprior to \d|\bbefore \d|\bunsupported version\b/i;

/**
 * Why an untriaged finding deserves a second look before it's reported, or
 * null when nothing about it looks doubtful.
 * @param {{ source_tool?: string, title?: string, confidence?: string|null, triage_status?: string|null }} f
 * @returns {string|null}
 */
export function needsReviewReason(f) {
	if (f.triage_status) return null;
	if (f.confidence && LOW_CONFIDENCE.has(String(f.confidence).toLowerCase())) {
		return `เครื่องมือมั่นใจต่ำ (${f.confidence})`;
	}
	if ((f.source_tool === 'nessus' || f.source_tool === 'openvas') && VERSION_ONLY.test(f.title ?? '')) {
		return 'ตัดสินจากเลขเวอร์ชันอย่างเดียว — OS ที่ backport แพตช์อาจแก้แล้ว';
	}
	return null;
}

/** Findings that should appear in reports and statistics (not false positives). */
export function withoutFalsePositives(findings) {
	return findings.filter((f) => f.triage_status !== 'false_positive');
}
