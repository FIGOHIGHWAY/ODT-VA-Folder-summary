import { json } from '@sveltejs/kit';
import { parseReport } from '$lib/server/parsers/index.js';
import { insertReport } from '$lib/server/db.js';

export async function POST({ request }) {
	const form = await request.formData();
	const file = form.get('file');

	if (!(file instanceof File)) {
		return json({ error: 'ต้องแนบไฟล์ HTML ในฟิลด์ "file"' }, { status: 400 });
	}

	const html = await file.text();

	let type, findings;
	try {
		({ type, findings } = parseReport(html, file.name));
	} catch (err) {
		return json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
	}

	try {
		const { reportId, insertedCount } = await insertReport({
			sourceTool: type,
			originalFilename: file.name,
			findings
		});
		return json({ reportId, type, insertedCount, findings });
	} catch (err) {
		return json(
			{ error: `บันทึกลงฐานข้อมูลไม่สำเร็จ: ${err instanceof Error ? err.message : String(err)}` },
			{ status: 500 }
		);
	}
}
