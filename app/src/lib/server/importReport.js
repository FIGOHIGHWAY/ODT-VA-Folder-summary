import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { parseReport } from './parsers/index.js';
import { parseOpenvasXml } from './parsers/openvas.js';
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
