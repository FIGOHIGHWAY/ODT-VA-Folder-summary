import { json } from '@sveltejs/kit';
import AdmZip from 'adm-zip';
import { parseAndInsert, parseAndInsertNucleiJsonlUpload } from '$lib/server/importReport.js';

const JSONL_PATTERN = /\.(jsonl|ndjson)$/i;
const HTML_PATTERN = /\.html?$/i;

/** Parse one uploaded file by its extension: Nuclei -jsonl, or an HTML report. */
function importByName(filename, text) {
	if (JSONL_PATTERN.test(filename)) return parseAndInsertNucleiJsonlUpload(filename, text);
	return parseAndInsert(filename, text);
}

export async function POST({ request }) {
	const form = await request.formData();
	const file = form.get('file');

	if (!(file instanceof File)) {
		return json({ error: 'ต้องแนบไฟล์ HTML, .jsonl หรือ ZIP ในฟิลด์ "file"' }, { status: 400 });
	}

	const isZip = file.name.toLowerCase().endsWith('.zip');

	if (!isZip) {
		try {
			const result = await importByName(file.name, await file.text());
			return json(result);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return json({ error: message }, { status: 422 });
		}
	}

	// ZIP: extract every .html/.htm/.jsonl entry and parse+insert each
	// independently — one bad file in the batch doesn't block the rest.
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
		.filter((e) => !e.isDirectory && (HTML_PATTERN.test(e.entryName) || JSONL_PATTERN.test(e.entryName)));

	if (entries.length === 0) {
		return json({ error: 'ไม่พบไฟล์ .html/.htm/.jsonl ใน ZIP นี้' }, { status: 422 });
	}

	const results = [];
	for (const entry of entries) {
		const filename = entry.entryName.split('/').pop();
		try {
			const { findings, ...result } = await importByName(filename, entry.getData().toString('utf-8'));
			// A multi-host report comes back as its own per-host batch.
			if (result.batch) results.push(...result.results);
			else results.push(result);
		} catch (err) {
			results.push({ filename, error: err instanceof Error ? err.message : String(err) });
		}
	}

	const duplicates = results.filter((r) => r.duplicate).length;
	const succeeded = results.filter((r) => !r.error && !r.duplicate).length;
	return json({ batch: true, total: results.length, succeeded, duplicates, results });
}
