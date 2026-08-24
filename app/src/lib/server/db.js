import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { env } from '$env/dynamic/private';

const { Pool } = pg;

const connectionString =
	env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/va_scan';

export const pool = new Pool({ connectionString });

/**
 * Extract a bare hostname from a finding's target, which may already be a
 * hostname (Nessus) or a full origin URL (ZAP).
 * @param {string|null|undefined} target
 * @returns {string|null}
 */
export function extractDomain(target) {
	if (!target) return null;
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(target)) {
		try {
			return new URL(target).hostname.toLowerCase();
		} catch {
			return null;
		}
	}
	return target.split(/[/:]/)[0].toLowerCase() || null;
}

/**
 * Pick the domain to file a report under: the hostname shared by most of its
 * findings, so one stray target doesn't misfile the whole report.
 * @param {Array<{ target?: string|null }>} findings
 * @returns {string|null}
 */
function pickDomain(findings) {
	/** @type {Map<string, number>} */
	const counts = new Map();
	for (const f of findings) {
		const domain = extractDomain(f.target);
		if (!domain) continue;
		counts.set(domain, (counts.get(domain) ?? 0) + 1);
	}
	let best = null;
	let bestCount = 0;
	for (const [domain, count] of counts) {
		if (count > bestCount) {
			best = domain;
			bestCount = count;
		}
	}
	return best;
}

/**
 * Look up a previously imported report by its content hash (sha256 of the
 * raw uploaded file), so a duplicate upload can be recognized and skipped
 * instead of creating a second copy of the same findings.
 * @param {string} contentHash
 * @returns {Promise<{ id: number, original_filename: string, imported_at: Date }|null>}
 */
export async function findReportByContentHash(contentHash) {
	if (!contentHash) return null;
	const { rows } = await pool.query(
		`SELECT id, original_filename, imported_at FROM reports WHERE content_hash = $1 LIMIT 1`,
		[contentHash]
	);
	return rows[0] ?? null;
}

/**
 * Insert a parsed report and its findings inside one transaction.
 * @param {{ sourceTool: 'nessus'|'zap', originalFilename: string, findings: Array<object>, contentHash?: string|null }} input
 * @returns {Promise<{ reportId: number, insertedCount: number, domain: string|null }>}
 */
export async function insertReport({ sourceTool, originalFilename, findings, contentHash = null }) {
	const domain = pickDomain(findings);
	const client = await pool.connect();
	try {
		await client.query('BEGIN');

		const reportResult = await client.query(
			`INSERT INTO reports (source_tool, original_filename, domain, content_hash) VALUES ($1, $2, $3, $4) RETURNING id`,
			[sourceTool, originalFilename, domain, contentHash]
		);
		const reportId = reportResult.rows[0].id;

		for (const f of findings) {
			await client.query(
				`INSERT INTO findings
					(report_id, source_tool, target, identifier, title, severity, description,
					 solution, cvss_score, cve, affected_url_or_port, confidence, raw_evidence)
				 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
				[
					reportId,
					f.source_tool,
					f.target ?? null,
					f.identifier,
					f.title,
					f.severity,
					f.description ?? null,
					f.solution ?? null,
					f.cvss_score ?? null,
					f.cve ?? null,
					f.affected_url_or_port ?? null,
					f.confidence ?? null,
					f.raw_evidence ?? null
				]
			);
		}

		await client.query('COMMIT');
		return { reportId, insertedCount: findings.length, domain };
	} catch (err) {
		await client.query('ROLLBACK');
		throw err;
	} finally {
		client.release();
	}
}

/**
 * List the most recently imported reports with their finding counts,
 * grouped into folders by domain (null/unrecognized domain goes into an
 * "unknown" bucket). Folders are ordered by most recently active report.
 * @param {number} limit
 * @returns {Promise<Array<{ domain: string, reports: Array<object> }>>}
 */
export async function listReportsByDomain(limit = 200) {
	const { rows } = await pool.query(
		`SELECT r.id, r.source_tool, r.original_filename, r.imported_at, r.domain,
		        COUNT(f.id)::int AS finding_count
		 FROM reports r
		 LEFT JOIN findings f ON f.report_id = r.id
		 GROUP BY r.id
		 ORDER BY r.imported_at DESC
		 LIMIT $1`,
		[limit]
	);

	/** @type {Map<string, Array<object>>} */
	const byDomain = new Map();
	for (const row of rows) {
		const key = row.domain || 'unknown';
		if (!byDomain.has(key)) byDomain.set(key, []);
		byDomain.get(key).push(row);
	}

	return [...byDomain.entries()]
		.map(([domain, reportsInDomain]) => ({ domain, reports: reportsInDomain }))
		.sort((a, b) => {
			if (a.domain === 'unknown') return 1;
			if (b.domain === 'unknown') return -1;
			return new Date(b.reports[0].imported_at) - new Date(a.reports[0].imported_at);
		});
}

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'];

/**
 * Overall counters for the dashboard: totals plus a findings-by-severity and
 * findings-by-tool breakdown across all imported reports.
 * @returns {Promise<{
 *   totalReports: number, totalFindings: number, totalDomains: number,
 *   yearsCovered: Array<number>,
 *   bySeverity: Array<{ severity: string, count: number }>,
 *   byTool: Array<{ source_tool: string, count: number }>
 * }>}
 */
export async function getDashboardSummary() {
	const [{ rows: totals }, { rows: severityRows }, { rows: toolRows }, { rows: yearRows }] =
		await Promise.all([
			pool.query(
				`SELECT
					(SELECT COUNT(*) FROM reports)::int AS total_reports,
					(SELECT COUNT(*) FROM findings)::int AS total_findings,
					(SELECT COUNT(DISTINCT domain) FROM reports WHERE domain IS NOT NULL)::int AS total_domains`
			),
			pool.query(`SELECT severity, COUNT(*)::int AS count FROM findings GROUP BY severity`),
			pool.query(
				`SELECT source_tool, COUNT(*)::int AS count FROM findings GROUP BY source_tool`
			),
			pool.query(
				`SELECT DISTINCT EXTRACT(YEAR FROM imported_at)::int AS year FROM findings ORDER BY year`
			)
		]);

	const countBySeverity = new Map(severityRows.map((r) => [r.severity, r.count]));
	const bySeverity = SEVERITY_ORDER.map((severity) => ({
		severity,
		count: countBySeverity.get(severity) ?? 0
	}));

	return {
		totalReports: totals[0].total_reports,
		totalFindings: totals[0].total_findings,
		totalDomains: totals[0].total_domains,
		yearsCovered: yearRows.map((r) => r.year),
		bySeverity,
		byTool: toolRows
	};
}

/**
 * Findings-by-severity counts broken down per calendar year (by
 * `findings.imported_at`), for the dashboard's year-over-year chart.
 * @returns {Promise<Array<{ year: number, total: number, critical: number, high: number, medium: number, low: number, info: number }>>}
 */
export async function getYearlyBreakdown() {
	const { rows } = await pool.query(
		`SELECT EXTRACT(YEAR FROM imported_at)::int AS year, severity, COUNT(*)::int AS count
		 FROM findings
		 GROUP BY year, severity
		 ORDER BY year`
	);

	/** @type {Map<number, object>} */
	const byYear = new Map();
	for (const row of rows) {
		if (!byYear.has(row.year)) {
			byYear.set(
				row.year,
				Object.fromEntries([
					['year', row.year],
					['total', 0],
					...SEVERITY_ORDER.map((s) => [s, 0])
				])
			);
		}
		const entry = byYear.get(row.year);
		entry[row.severity] = row.count;
		entry.total += row.count;
	}

	return [...byYear.values()].sort((a, b) => a.year - b.year);
}

/**
 * Full-text-ish search across findings (title, identifier, description,
 * solution, CVE, target) and their parent report's domain, case-insensitive.
 * @param {string} query
 * @param {number} limit
 * @returns {Promise<Array<object>>}
 */
export async function searchFindings(query, limit = 200) {
	const trimmed = query.trim();
	if (!trimmed) return [];

	const pattern = `%${trimmed}%`;
	const { rows } = await pool.query(
		`SELECT f.id, f.report_id, f.source_tool, f.target, f.identifier, f.title, f.severity,
		        f.description, f.solution, f.cvss_score, f.cve, f.affected_url_or_port,
		        r.domain, r.original_filename
		 FROM findings f
		 JOIN reports r ON r.id = f.report_id
		 WHERE f.title ILIKE $1
		    OR f.identifier ILIKE $1
		    OR f.description ILIKE $1
		    OR f.solution ILIKE $1
		    OR f.cve ILIKE $1
		    OR f.target ILIKE $1
		    OR r.domain ILIKE $1
		 ORDER BY
		   CASE f.severity
		     WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2
		     WHEN 'low' THEN 3 ELSE 4
		   END, f.id DESC
		 LIMIT $2`,
		[pattern, limit]
	);
	return rows;
}

/**
 * Get the most recently cached AI summary for a domain, if one exists.
 * @param {string} domain
 */
export async function getAiSummary(domain) {
	const { rows } = await pool.query(
		`SELECT domain, summary, model, finding_count, created_at FROM ai_summaries WHERE domain = $1`,
		[domain]
	);
	return rows[0] ?? null;
}

/**
 * Cache (upsert) an AI-generated summary for a domain.
 * @param {{ domain: string, summary: string, model: string, findingCount: number }} params
 */
export async function saveAiSummary({ domain, summary, model, findingCount }) {
	await pool.query(
		`INSERT INTO ai_summaries (domain, summary, model, finding_count, created_at)
		 VALUES ($1, $2, $3, $4, now())
		 ON CONFLICT (domain) DO UPDATE SET
		   summary = EXCLUDED.summary, model = EXCLUDED.model,
		   finding_count = EXCLUDED.finding_count, created_at = EXCLUDED.created_at`,
		[domain, summary, model, findingCount]
	);
}

/**
 * Get the active (non-revoked) share link for a domain, if one exists.
 * @param {string} domain
 */
export async function getActiveShareLink(domain) {
	const { rows } = await pool.query(
		`SELECT token, domain, created_at FROM share_links
		 WHERE domain = $1 AND revoked_at IS NULL
		 ORDER BY created_at DESC LIMIT 1`,
		[domain]
	);
	return rows[0] ?? null;
}

/**
 * Create a new share link for a domain (an unguessable random token — the
 * link itself is the access control, so no login is required to view it).
 * @param {{ domain: string, createdBy?: string|null }} params
 */
export async function createShareLink({ domain, createdBy = null }) {
	const token = randomBytes(18).toString('base64url');
	const { rows } = await pool.query(
		`INSERT INTO share_links (token, domain, created_by) VALUES ($1, $2, $3)
		 RETURNING token, domain, created_at`,
		[token, domain, createdBy]
	);
	return rows[0];
}

/**
 * Revoke every active share link for a domain.
 * @param {string} domain
 */
export async function revokeShareLinksForDomain(domain) {
	await pool.query(
		`UPDATE share_links SET revoked_at = now() WHERE domain = $1 AND revoked_at IS NULL`,
		[domain]
	);
}

/**
 * Resolve a share token to its domain, or null if the token doesn't exist
 * or has been revoked.
 * @param {string} token
 * @returns {Promise<string|null>}
 */
export async function resolveShareToken(token) {
	const { rows } = await pool.query(
		`SELECT domain FROM share_links WHERE token = $1 AND revoked_at IS NULL`,
		[token]
	);
	return rows[0]?.domain ?? null;
}

/**
 * List reports + finding counts for a single domain, most recent first —
 * the scoped view a share link exposes (no cross-domain data).
 * @param {string} domain
 */
export async function listReportsForDomain(domain) {
	const { rows } = await pool.query(
		`SELECT r.id, r.source_tool, r.original_filename, r.imported_at,
		        COUNT(f.id)::int AS finding_count
		 FROM reports r
		 LEFT JOIN findings f ON f.report_id = r.id
		 WHERE r.domain = $1
		 GROUP BY r.id
		 ORDER BY r.imported_at DESC`,
		[domain]
	);
	return rows;
}

/**
 * List every finding across every report filed under a domain, most severe
 * first — the flattened view a share link shows.
 * @param {string} domain
 */
export async function listFindingsForDomain(domain) {
	const { rows } = await pool.query(
		`SELECT f.*, r.original_filename, r.imported_at AS report_imported_at
		 FROM findings f
		 JOIN reports r ON r.id = f.report_id
		 WHERE r.domain = $1
		 ORDER BY
		   CASE f.severity
		     WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2
		     WHEN 'low' THEN 3 ELSE 4
		   END, f.id`,
		[domain]
	);
	return rows;
}

/**
 * Findings for only the most recent scan "round" of a domain — every report
 * imported on the same calendar date as the domain's latest import (so a
 * ZAP+Nessus pair uploaded together the same day counts as one round, but
 * older rounds are excluded). Used for exports, where "latest" should mean
 * the newest scan, not every scan ever run against the domain.
 * @param {string} domain
 */
export async function listFindingsForLatestRound(domain) {
	const { rows } = await pool.query(
		`WITH latest_date AS (
			SELECT MAX(imported_at::date) AS d FROM reports WHERE domain = $1
		 )
		 SELECT f.*, r.original_filename, r.imported_at AS report_imported_at
		 FROM findings f
		 JOIN reports r ON r.id = f.report_id
		 WHERE r.domain = $1 AND r.imported_at::date = (SELECT d FROM latest_date)
		 ORDER BY
		   CASE f.severity
		     WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2
		     WHEN 'low' THEN 3 ELSE 4
		   END, f.id`,
		[domain]
	);
	return rows;
}

/**
 * Get a single central setting's value (e.g. the AI system prompt), or null
 * if it has never been set (caller should fall back to a hardcoded default).
 * @param {string} key
 * @returns {Promise<string|null>}
 */
export async function getSetting(key) {
	const { rows } = await pool.query(`SELECT value FROM settings WHERE key = $1`, [key]);
	return rows[0]?.value ?? null;
}

/**
 * Upsert a central setting.
 * @param {{ key: string, value: string, updatedBy?: string|null }} params
 */
export async function setSetting({ key, value, updatedBy = null }) {
	await pool.query(
		`INSERT INTO settings (key, value, updated_at, updated_by)
		 VALUES ($1, $2, now(), $3)
		 ON CONFLICT (key) DO UPDATE SET
		   value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
		[key, value, updatedBy]
	);
}

/**
 * List every email added to the DB-managed allowlist (in addition to the
 * ALLOWED_EMAILS env var), most recently added first.
 * @returns {Promise<Array<{ email: string, note: string|null, role: string, added_by: string|null, added_at: Date }>>}
 */
export async function listAllowedUsers() {
	const { rows } = await pool.query(
		`SELECT email, note, role, added_by, added_at FROM allowed_users ORDER BY added_at DESC`
	);
	return rows;
}

/**
 * Add an email to the DB-managed allowlist, or update its note/role if it's
 * already there.
 * @param {{ email: string, note?: string|null, role?: string, addedBy?: string|null }} params
 */
export async function addAllowedUser({ email, note = null, role = 'user', addedBy = null }) {
	const normalized = email.trim().toLowerCase();
	await pool.query(
		`INSERT INTO allowed_users (email, note, role, added_by, added_at)
		 VALUES ($1, $2, $3, $4, now())
		 ON CONFLICT (email) DO UPDATE SET note = EXCLUDED.note, role = EXCLUDED.role, added_by = EXCLUDED.added_by`,
		[normalized, note, role, addedBy]
	);
}

/**
 * Change the role of an existing DB-managed allowlist entry.
 * @param {string} email
 * @param {string} role
 */
export async function setAllowedUserRole(email, role) {
	await pool.query(`UPDATE allowed_users SET role = $2 WHERE email = $1`, [
		email.trim().toLowerCase(),
		role
	]);
}

/**
 * Look up the role for a DB-managed allowlist entry, or null if the email
 * isn't in the table (e.g. it's only in the ALLOWED_EMAILS env var).
 * @param {string} email
 * @returns {Promise<string|null>}
 */
export async function getAllowedUserRole(email) {
	const { rows } = await pool.query(`SELECT role FROM allowed_users WHERE email = $1`, [
		email.trim().toLowerCase()
	]);
	return rows[0]?.role ?? null;
}

/**
 * Remove an email from the DB-managed allowlist. Emails from the
 * ALLOWED_EMAILS env var are not affected — this can't lock out whoever is
 * configured there.
 * @param {string} email
 */
export async function removeAllowedUser(email) {
	await pool.query(`DELETE FROM allowed_users WHERE email = $1`, [email.trim().toLowerCase()]);
}

/**
 * Check whether an email exists in the DB-managed allowlist.
 * @param {string} email
 */
export async function isEmailInAllowedUsers(email) {
	const { rows } = await pool.query(`SELECT 1 FROM allowed_users WHERE email = $1`, [
		email.trim().toLowerCase()
	]);
	return rows.length > 0;
}

/**
 * Get a user's own AI Gateway credentials (per-user — never a shared/global
 * key), or null if they haven't connected one yet.
 * @param {string} email
 * @returns {Promise<{ email: string, api_key: string, base_url: string|null, model: string|null, updated_at: Date }|null>}
 */
export async function getUserAiKey(email) {
	const { rows } = await pool.query(
		`SELECT email, api_key, base_url, model, updated_at FROM user_ai_keys WHERE email = $1`,
		[email.trim().toLowerCase()]
	);
	return rows[0] ?? null;
}

/**
 * Save (upsert) a user's own AI Gateway credentials.
 * @param {{ email: string, apiKey: string, baseUrl?: string|null, model?: string|null }} params
 */
export async function setUserAiKey({ email, apiKey, baseUrl = null, model = null }) {
	await pool.query(
		`INSERT INTO user_ai_keys (email, api_key, base_url, model, updated_at)
		 VALUES ($1, $2, $3, $4, now())
		 ON CONFLICT (email) DO UPDATE SET
		   api_key = EXCLUDED.api_key, base_url = EXCLUDED.base_url,
		   model = EXCLUDED.model, updated_at = now()`,
		[email.trim().toLowerCase(), apiKey, baseUrl, model]
	);
}

/**
 * Remove a user's own AI Gateway credentials (disconnect).
 * @param {string} email
 */
export async function deleteUserAiKey(email) {
	await pool.query(`DELETE FROM user_ai_keys WHERE email = $1`, [email.trim().toLowerCase()]);
}

/**
 * List findings for a given report.
 * @param {number} reportId
 */
export async function listFindingsForReport(reportId) {
	const { rows } = await pool.query(
		`SELECT * FROM findings WHERE report_id = $1 ORDER BY
		 CASE severity
		   WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2
		   WHEN 'low' THEN 3 ELSE 4
		 END, id`,
		[reportId]
	);
	return rows;
}
