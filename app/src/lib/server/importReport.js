import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { parseReport, PER_HOST_TYPES } from './parsers/index.js';
import { parseOpenvasXml } from './parsers/openvas.js';
import { parseNucleiJsonl } from './parsers/nuclei.js';
import { parseZapAlerts } from './parsers/zapAlerts.js';
import { insertReport, findReportByContentHash } from './db.js';

function hashContent(html) {
	return createHash('sha256').update(html, 'utf-8').digest('hex');
}

/**
 * Parse a report's HTML and insert it, skipping if an identical report
 * (by content hash) was already imported.
 * @param {string} filename
 * @param {string} html
 */
export async function parseAndInsert(filename, html) {
	const contentHash = hashContent(html);

	const existing = await findReportByContentHash(contentHash);
	if (existing) {
		return {
			filename,
			duplicate: true,
			existingReportId: existing.id,
			existingFilename: existing.original_filename,
			existingImportedAt: existing.imported_at
		};
	}

	const { type, findings } = parseReport(html, filename);
	if (PER_HOST_TYPES.has(type)) {
		return insertPerHost(filename, html, type, findings);
	}
	const rawHtmlGz = gzipSync(Buffer.from(html, 'utf-8'));
	const { reportId, insertedCount } = await insertReport({
		sourceTool: type,
		originalFilename: filename,
		findings,
		contentHash,
		rawHtmlGz
	});
	return { filename, reportId, type, insertedCount, findings };
}

/**
 * File a report that covers many unrelated hosts (e.g. one CVE swept across
 * whole networks) as one report per host, so each host keeps its own domain,
 * triage decisions and history instead of all of them landing under one
 * host. Duplicates are detected per host — the hash covers the file plus the
 * host — so re-uploading the same file skips every host already imported.
 * Returns the batch shape the upload page already renders for ZIP uploads.
 * @param {string} filename
 * @param {string} html
 * @param {string} type
 * @param {Array<object>} findings
 */
async function insertPerHost(filename, html, type, findings) {
	/** @type {Map<string, Array<object>>} */
	const byHost = new Map();
	for (const f of findings) {
		const host = f.target ?? 'unknown';
		if (!byHost.has(host)) byHost.set(host, []);
		byHost.get(host).push(f);
	}

	const rawHtmlGz = gzipSync(Buffer.from(html, 'utf-8'));
	const results = [];
	for (const [host, hostFindings] of byHost) {
		const label = `${filename} · ${host}`;
		const contentHash = hashContent(`${html}\n${host}`);
		const existing = await findReportByContentHash(contentHash);
		if (existing) {
			results.push({
				filename: label,
				duplicate: true,
				existingReportId: existing.id,
				existingFilename: existing.original_filename,
				existingImportedAt: existing.imported_at
			});
			continue;
		}
		const { reportId, insertedCount } = await insertReport({
			sourceTool: type,
			originalFilename: label,
			findings: hostFindings,
			contentHash,
			rawHtmlGz
		});
		results.push({ filename: label, reportId, type, insertedCount });
	}

	const duplicates = results.filter((r) => r.duplicate).length;
	return {
		filename,
		batch: true,
		total: results.length,
		succeeded: results.length - duplicates,
		duplicates,
		results
	};
}

/**
 * Parse a GMP get_reports XML export from OpenVAS and insert it, skipping if
 * an identical report (by content hash) was already imported.
 * @param {string} filename
 * @param {string} xml
 */
export async function parseAndInsertOpenvas(filename, xml) {
	const contentHash = hashContent(xml);

	const existing = await findReportByContentHash(contentHash);
	if (existing) {
		return {
			filename,
			duplicate: true,
			existingReportId: existing.id,
			existingFilename: existing.original_filename,
			existingImportedAt: existing.imported_at
		};
	}

	const findings = parseOpenvasXml(xml, filename);
	const rawHtmlGz = gzipSync(Buffer.from(xml, 'utf-8'));
	const { reportId, insertedCount } = await insertReport({
		sourceTool: 'openvas',
		originalFilename: filename,
		findings,
		contentHash,
		rawHtmlGz
	});
	return { filename, reportId, type: 'openvas', insertedCount, findings };
}

/**
 * Parse Nuclei's `-jsonl` scan output and insert it, skipping if an
 * identical report (by content hash) was already imported.
 * @param {string} filename
 * @param {string} jsonl
 * @param {string|null} [domainOverride] host to file the report under (e.g. a scan's Host header)
 */
export async function parseAndInsertNuclei(filename, jsonl, domainOverride = null) {
	const contentHash = hashContent(jsonl);

	const existing = await findReportByContentHash(contentHash);
	if (existing) {
		return {
			filename,
			duplicate: true,
			existingReportId: existing.id,
			existingFilename: existing.original_filename,
			existingImportedAt: existing.imported_at
		};
	}

	const findings = parseNucleiJsonl(jsonl, filename);
	const rawHtmlGz = gzipSync(Buffer.from(jsonl, 'utf-8'));
	const { reportId, insertedCount } = await insertReport({
		sourceTool: 'nuclei',
		originalFilename: filename,
		findings,
		contentHash,
		rawHtmlGz,
		domainOverride
	});
	return { filename, reportId, type: 'nuclei', insertedCount, findings };
}

/**
 * Parse the alerts array from a live ZAP scan and insert it, skipping if an
 * identical report (by content hash) was already imported.
 * @param {string} filename
 * @param {Array<object>} alerts
 * @param {string|null} [domainOverride] host to file the report under (e.g. a scan's Host header)
 */
export async function parseAndInsertZap(filename, alerts, domainOverride = null) {
	const json = JSON.stringify(alerts);
	const contentHash = hashContent(json);

	const existing = await findReportByContentHash(contentHash);
	if (existing) {
		return {
			filename,
			duplicate: true,
			existingReportId: existing.id,
			existingFilename: existing.original_filename,
			existingImportedAt: existing.imported_at
		};
	}

	const findings = parseZapAlerts(alerts, filename);
	const rawHtmlGz = gzipSync(Buffer.from(json, 'utf-8'));
	const { reportId, insertedCount } = await insertReport({
		sourceTool: 'zap',
		originalFilename: filename,
		findings,
		contentHash,
		rawHtmlGz,
		domainOverride
	});
	return { filename, reportId, type: 'zap', insertedCount, findings };
}
