import PDFDocument from 'pdfkit';

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

/**
 * Render findings as a PDF report (Buffer) — one row per finding, most
 * severe first, grouped visually by a title header.
 * @param {Array<object>} findings
 * @param {{ title: string, subtitle?: string }} params
 * @returns {Promise<Buffer>}
 */
export function findingsToPdf(findings, { title, subtitle }) {
	return new Promise((resolve, reject) => {
		const doc = new PDFDocument({ margin: 36, size: 'A4', layout: 'landscape' });
		/** @type {Buffer[]} */
		const chunks = [];
		doc.on('data', (chunk) => chunks.push(chunk));
		doc.on('end', () => resolve(Buffer.concat(chunks)));
		doc.on('error', reject);

		doc.fontSize(16).text(title, { continued: false });
		if (subtitle) {
			doc.fontSize(10).fillColor('#666666').text(subtitle);
			doc.fillColor('#000000');
		}
		doc.moveDown(0.5);

		const sorted = [...findings].sort(
			(a, b) => (SEVERITY_ORDER[a.severity] ?? 5) - (SEVERITY_ORDER[b.severity] ?? 5)
		);

		const columns = [
			{ key: 'severity', label: 'Severity', width: 60 },
			{ key: 'title', label: 'Title', width: 200 },
			{ key: 'target', label: 'Target', width: 130 },
			{ key: 'cve', label: 'CVE', width: 80 },
			{ key: 'cvss_score', label: 'CVSS', width: 40 },
			{ key: 'solution', label: 'Solution', width: 220 }
		];

		const startX = doc.page.margins.left;
		const tableWidth = columns.reduce((sum, c) => sum + c.width, 0);
		let y = doc.y;

		function drawHeader() {
			doc.font('Helvetica-Bold').fontSize(9);
			let x = startX;
			for (const col of columns) {
				doc.text(col.label, x, y, { width: col.width, ellipsis: true });
				x += col.width;
			}
			y += 16;
			doc.moveTo(startX, y).lineTo(startX + tableWidth, y).strokeColor('#cccccc').stroke();
			y += 4;
			doc.font('Helvetica').fontSize(8);
		}

		drawHeader();

		for (const f of sorted) {
			const cellTexts = columns.map((col) => String(f[col.key] ?? '—'));
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
				doc.text(cellTexts[i], x, y, { width: columns[i].width, ellipsis: true });
				x += columns[i].width;
			}
			y += rowHeight;
		}

		doc.end();
	});
}
