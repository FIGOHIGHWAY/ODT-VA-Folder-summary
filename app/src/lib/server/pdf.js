import path from 'node:path';
import PDFDocument from 'pdfkit';
import { groupFindingsByTitle } from './groupFindings.js';

const TOOL_LABEL = { nessus: 'Nessus', zap: 'ZAP', burp: 'Burp', openvas: 'OpenVAS', nuclei: 'Nuclei' };

/** Affected targets listed per row before collapsing the rest into "และอีก N". */
const MAX_TARGETS_PER_ROW = 5;
const MAX_SOLUTION_CHARS = 700;
const SEVERITY_COLOR = { critical: '#b91c1c', high: '#ea580c', medium: '#ca8a04', low: '#2563eb', info: '#6b7280' };

function plainText(text) {
	const flat = String(text ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
	return flat.length > MAX_SOLUTION_CHARS ? `${flat.slice(0, MAX_SOLUTION_CHARS)}…` : flat;
}

/** Show percent-encoded (e.g. Thai) URLs as readable text; leave malformed ones as-is. */
function readableUrl(url) {
	try {
		return decodeURI(url);
	} catch {
		return url;
	}
}

/** Cell texts for one grouped vulnerability row. */
function groupCells(g) {
	const tools = g.source_tools.map((t) => TOOL_LABEL[t] ?? t).join(', ');
	const shown = g.targets.slice(0, MAX_TARGETS_PER_ROW).map(readableUrl);
	const hidden = g.targets.length - shown.length;
	return {
		severity: g.severity,
		title: `${g.title}\nพบ ${g.count} จุด ใน ${g.targets.length} URL/host${tools ? ` · ${tools}` : ''}`,
		targets: shown.length
			? shown.join('\n') + (hidden > 0 ? `\n…และอีก ${hidden} รายการ` : '')
			: '—',
		cve: g.cves.length ? g.cves.join(', ') : '—',
		cvss_score: g.cvss_score ?? '—',
		solution: plainText(g.solution) || '—'
	};
}

// pdfkit's built-in fonts (Helvetica etc.) have no Thai glyphs, so Thai text
// renders as mojibake. Sarabun covers both Thai and Latin. The Dockerfile
// copies app/fonts next to the build, so this resolves from the app root in
// both dev and production.
const FONT_DIR = path.join(process.cwd(), 'fonts');
const FONT_REGULAR = path.join(FONT_DIR, 'Sarabun-Regular.ttf');
const FONT_BOLD = path.join(FONT_DIR, 'Sarabun-Bold.ttf');

/**
 * Render findings as a PDF report (Buffer) — one row per vulnerability
 * (findings sharing a title are merged, listing every affected target),
 * most severe first. When `networkSummary` is given (a multi-host/CIDR
 * scan), a per-network breakdown table is drawn first, and an all-clear
 * message replaces the finding table when there are no findings at all
 * rather than leaving an empty page.
 * @param {Array<object>} findings
 * @param {{ title: string, subtitle?: string, networkSummary?: { networks: Array<{ block: string, ipCount: number, vulnerableCount: number }>, totalIps: number, totalVulnerable: number } | null }} params
 * @returns {Promise<Buffer>}
 */
export function findingsToPdf(findings, { title, subtitle, networkSummary = null }) {
	return new Promise((resolve, reject) => {
		const doc = new PDFDocument({ margin: 36, size: 'A4', layout: 'landscape' });
		/** @type {Buffer[]} */
		const chunks = [];
		doc.on('data', (chunk) => chunks.push(chunk));
		doc.on('end', () => resolve(Buffer.concat(chunks)));
		doc.on('error', reject);

		doc.registerFont('Body', FONT_REGULAR);
		doc.registerFont('Body-Bold', FONT_BOLD);
		doc.font('Body');

		doc.fontSize(16).text(title, { continued: false });
		if (subtitle) {
			doc.fontSize(10).fillColor('#666666').text(subtitle);
			doc.fillColor('#000000');
		}
		doc.moveDown(0.5);

		if (networkSummary) {
			doc.font('Body-Bold').fontSize(11).text('สรุปผลรายเครือข่าย');
			doc.font('Body').fontSize(9).moveDown(0.3);
			doc.text(
				`เครือข่ายที่สแกน: ${networkSummary.networks.length}   IP ที่สแกนทั้งหมด: ${networkSummary.totalIps}   โฮสต์ที่พบช่องโหว่: ${networkSummary.totalVulnerable}`
			);
			doc.moveDown(0.4);
			for (const net of networkSummary.networks) {
				const verdict = net.vulnerableCount > 0 ? `พบช่องโหว่ ${net.vulnerableCount} โฮสต์` : 'ไม่พบช่องโหว่';
				doc.text(`${net.block}  (${net.ipCount} IP)  —  ${verdict}`);
			}
			doc.moveDown(0.8);
		}

		if (findings.length === 0) {
			doc.font('Body-Bold').fontSize(12).text('ไม่พบช่องโหว่จากการสแกนนี้');
			doc.end();
			return;
		}

		const groups = groupFindingsByTitle(findings);
		doc.font('Body').fontSize(10).text(
			`ช่องโหว่ ${groups.length} หัวข้อ (พบรวม ${findings.length} จุด) — รวมรายการที่ชื่อเดียวกันไว้ในแถวเดียว`
		);
		doc.moveDown(0.5);

		const columns = [
			{ key: 'severity', label: 'Severity', width: 55 },
			{ key: 'title', label: 'Vulnerability', width: 190 },
			{ key: 'targets', label: 'Affected targets', width: 210 },
			{ key: 'cve', label: 'CVE', width: 85 },
			{ key: 'cvss_score', label: 'CVSS', width: 35 },
			{ key: 'solution', label: 'Solution', width: 195 }
		];

		const startX = doc.page.margins.left;
		const tableWidth = columns.reduce((sum, c) => sum + c.width, 0);
		let y = doc.y;

		function drawHeader() {
			doc.font('Body-Bold').fontSize(9);
			let x = startX;
			for (const col of columns) {
				doc.text(col.label, x, y, { width: col.width, ellipsis: true });
				x += col.width;
			}
			y += 16;
			doc.moveTo(startX, y).lineTo(startX + tableWidth, y).strokeColor('#cccccc').stroke();
			y += 4;
			doc.font('Body').fontSize(8);
		}

		drawHeader();

		for (const g of groups) {
			const cells = groupCells(g);
			const cellTexts = columns.map((col) => String(cells[col.key]));
			const rowHeight =
				Math.max(
					...cellTexts.map((t, i) =>
						doc.heightOfString(t, { width: columns[i].width })
					)
				) + 6;

			if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
				doc.addPage();
				y = doc.page.margins.top;
				drawHeader();
			}

			let x = startX;
			for (let i = 0; i < columns.length; i++) {
				const isSeverity = columns[i].key === 'severity';
				if (isSeverity) doc.font('Body-Bold').fillColor(SEVERITY_COLOR[g.severity] ?? '#000000');
				doc.text(cellTexts[i], x, y, { width: columns[i].width, ellipsis: true });
				if (isSeverity) doc.font('Body').fillColor('#000000');
				x += columns[i].width;
			}
			y += rowHeight;
			doc.moveTo(startX, y - 3).lineTo(startX + tableWidth, y - 3).strokeColor('#eeeeee').stroke();
		}

		doc.end();
	});
}
