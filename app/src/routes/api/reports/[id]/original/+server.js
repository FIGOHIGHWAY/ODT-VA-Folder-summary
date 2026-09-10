import { error } from '@sveltejs/kit';
import { gunzipSync } from 'node:zlib';
import { getReportRawHtml } from '$lib/server/db.js';

export async function GET({ params }) {
	const reportId = Number(params.id);
	if (!Number.isInteger(reportId)) {
		throw error(400, 'invalid report id');
	}

	const report = await getReportRawHtml(reportId);
	if (!report) {
		throw error(404, `ไม่พบ report #${reportId}`);
	}
	if (!report.raw_html) {
		throw error(
			404,
			`ไม่มีไฟล์ต้นฉบับเก็บไว้สำหรับ report นี้ — report นี้ถูกนำเข้าก่อนที่ระบบจะเริ่มเก็บไฟล์ต้นฉบับ`
		);
	}

	const html = gunzipSync(report.raw_html);
	return new Response(html, {
		headers: {
			'Content-Type': 'text/html; charset=utf-8',
			'Content-Disposition': `attachment; filename="${report.original_filename}"`
		}
	});
}
