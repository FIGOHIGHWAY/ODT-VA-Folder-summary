import { json } from '@sveltejs/kit';
import AdmZip from 'adm-zip';
import { parseReport } from '$lib/server/parsers/index.js';
import { insertReport } from '$lib/server/db.js';

async function parseAndInsert(filename, html) {
	const { type, findings } = parseReport(html, filename);
	const { reportId, insertedCount } = await insertReport({
		sourceTool: type,
		originalFilename: filename,
		findings
	});
	return { filename, reportId, type, insertedCount, findings };
}

export async function POST({ request }) {
	const form = await request.formData();
	const file = form.get('file');

	if (!(file instanceof File)) {
		return json({ error: 'ต้องแนบไฟล์ HTML หรือ ZIP ในฟิลด์ "file"' }, { status: 400 });
	}

	const isZip = file.name.toLowerCase().endsWith('.zip');

	if (!isZip) {
		const html = await file.text();
		try {
			const result = await parseAndInsert(file.name, html);
			return json(result);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return json({ error: message }, { status: 422 });
		}
	}

	// ZIP: extract every .html/.htm entry and parse+insert each independently
	// — one bad file in the batch doesn't block the rest.
	const buffer = Buffer.from(await file.arrayBuffer());
	let zip;
	try {
		zip = new AdmZip(buffer);
	} catch (err) {
		return json(
			{ error: `เปิดไฟล์ ZIP ไม่ได้: ${err instanceof Error ? err.message : String(err)}` },
			{ status: 422 }
		);
	}

	const entries = zip
		.getEntries()
		.filter((e) => !e.isDirectory && /\.html?$/i.test(e.entryName));

	if (entries.length === 0) {
		return json({ error: 'ไม่พบไฟล์ .html/.htm ใน ZIP นี้' }, { status: 422 });
	}

	const results = [];
	for (const entry of entries) {
		const filename = entry.entryName.split('/').pop();
		try {
			const html = entry.getData().toString('utf-8');
			const { findings, ...result } = await parseAndInsert(filename, html);
			results.push(result);
		} catch (err) {
			results.push({ filename, error: err instanceof Error ? err.message : String(err) });
		}
	}

	const succeeded = results.filter((r) => !r.error).length;
	return json({ batch: true, total: results.length, succeeded, results });
}
