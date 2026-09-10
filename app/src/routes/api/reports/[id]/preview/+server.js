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
			// Inline (not attachment) so the browser renders it directly in a
			// new tab instead of downloading — this is an uploaded scan
			// report we don't fully control, so a strict CSP neutralizes any
			// embedded script while still letting the report's own inline
			// CSS/images render normally.
			'Content-Disposition': `inline; filename="${report.original_filename}"`,
			'Content-Security-Policy':
				"default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:",
			'X-Content-Type-Options': 'nosniff'
		}
	});
}
