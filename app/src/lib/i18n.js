import { writable } from 'svelte/store';

export const LANG_STORAGE_KEY = 'va-scan-lang';

/** @type {import('svelte/store').Writable<'th'|'en'>} */
export const lang = writable('th');

export function initLang() {
	if (typeof localStorage === 'undefined') return;
	const stored = localStorage.getItem(LANG_STORAGE_KEY);
	if (stored === 'th' || stored === 'en') lang.set(stored);
}

export function setLang(value) {
	lang.set(value);
	if (typeof localStorage !== 'undefined') localStorage.setItem(LANG_STORAGE_KEY, value);
	if (typeof document !== 'undefined') document.documentElement.lang = value;
}

const dict = {
	th: {
		brand: 'ODT KKU',
		nav_home: '🏠 หน้าแรก',
		nav_search: '🔍 ค้นหา',
		nav_dashboard: '📊 Dashboard',
		nav_ai_key: '🔌 AI ของฉัน',
		nav_users: '👥 จัดการผู้ใช้',
		nav_settings: '⚙️ ตั้งค่า AI Prompt',
		nav_logout: 'ออกจากระบบ',
		nav_login: '🔐 เข้าสู่ระบบด้วย KKU SSO',
		theme_toggle: 'สลับธีม',

		home_eyebrow: 'nessus · zap → unified json → postgres',
		home_title: 'Scan Report Normalizer',
		home_sub: 'อัปโหลดไฟล์ HTML export จาก Nessus หรือ OWASP ZAP ระบบจะ detect ประเภท, parse เป็น JSON schema เดียวกัน แล้วบันทึกลง PostgreSQL อัตโนมัติ',
		home_drop: '📄 คลิกหรือลากไฟล์ HTML export (หรือ ZIP รวมหลายไฟล์) มาวางที่นี่',
		home_parsing: 'กำลัง parse...',
		home_saved: 'บันทึกสำเร็จ',
		home_view_detail: 'ดูรายละเอียด →',
		home_parse_failed: 'Parse failed',
		home_reports_title: 'รายงานที่เคยนำเข้า (จัดกลุ่มตาม domain)',
		home_view_list: '📋 รายการ',
		home_view_details: '📊 รายละเอียด',
		home_no_reports: 'ยังไม่มีรายงานที่นำเข้า',
		home_db_error: 'เชื่อมต่อฐานข้อมูลไม่สำเร็จ',
		home_col_name: 'ชื่อ',
		home_col_modified: 'แก้ไขเมื่อ',
		home_col_type: 'ประเภท',
		home_col_reports: 'จำนวนรายงาน',
		home_file_folder: 'File folder',
		home_col_report: 'Report',
		home_col_tool: 'Tool',
		home_col_file: 'File',
		home_col_findings: 'Findings',
		home_col_imported: 'Imported',
		home_view: 'ดู →',
		home_duplicate_skipped: 'ข้ามไฟล์ซ้ำ',
		home_duplicate_of: 'ไฟล์ซ้ำกับที่นำเข้าไว้แล้ว',
		home_already_imported: 'ไฟล์นี้เคยนำเข้าไว้แล้ว',
		home_duplicate_of_full: 'ซ้ำกับ',
		home_imported_at: 'นำเข้าเมื่อ',
		home_view_original: 'ดูรายงานเดิม →',
		home_batch_imported: 'นำเข้าจาก ZIP สำเร็จ',
		home_files_suffix: 'ไฟล์',

		login_title: 'เข้าสู่ระบบ',
		login_desc: 'ระบบนี้ต้องเข้าสู่ระบบด้วยบัญชี KKU ก่อนใช้งาน กด "เข้าสู่ระบบด้วย KKU SSO" เพื่อไปยังหน้ายืนยันตัวตนของมหาวิทยาลัยขอนแก่น',
		login_button: '🔐 เข้าสู่ระบบด้วย KKU SSO',
		login_redirect_note: 'คุณจะถูกนำไปยัง',

		back_home: '← กลับหน้าแรก'
	},
	en: {
		brand: 'ODT KKU',
		nav_home: '🏠 Home',
		nav_search: '🔍 Search',
		nav_dashboard: '📊 Dashboard',
		nav_ai_key: '🔌 My AI',
		nav_users: '👥 Manage Users',
		nav_settings: '⚙️ AI Prompt Settings',
		nav_logout: 'Log out',
		nav_login: '🔐 Sign in with KKU SSO',
		theme_toggle: 'Toggle theme',

		home_eyebrow: 'nessus · zap → unified json → postgres',
		home_title: 'Scan Report Normalizer',
		home_sub: 'Upload an HTML export from Nessus or OWASP ZAP — the system detects the type, parses it into one unified JSON schema, and saves it to PostgreSQL automatically.',
		home_drop: '📄 Click or drag an HTML export (or a ZIP of several) here',
		home_parsing: 'Parsing...',
		home_saved: 'Saved successfully',
		home_view_detail: 'View details →',
		home_parse_failed: 'Parse failed',
		home_reports_title: 'Imported reports (grouped by domain)',
		home_view_list: '📋 List',
		home_view_details: '📊 Details',
		home_no_reports: 'No reports imported yet',
		home_db_error: 'Failed to connect to the database',
		home_col_name: 'Name',
		home_col_modified: 'Date modified',
		home_col_type: 'Type',
		home_col_reports: 'Reports',
		home_file_folder: 'File folder',
		home_col_report: 'Report',
		home_col_tool: 'Tool',
		home_col_file: 'File',
		home_col_findings: 'Findings',
		home_col_imported: 'Imported',
		home_view: 'View →',
		home_duplicate_skipped: 'Skipped duplicates',
		home_duplicate_of: 'Duplicate of an already-imported file',
		home_already_imported: 'This file was already imported',
		home_duplicate_of_full: 'Duplicate of',
		home_imported_at: 'imported at',
		home_view_original: 'View original report →',
		home_batch_imported: 'Imported from ZIP',
		home_files_suffix: 'file(s)',

		login_title: 'Sign in',
		login_desc: 'This system requires a KKU account to sign in. Click "Sign in with KKU SSO" to go to Khon Kaen University\'s identity verification page.',
		login_button: '🔐 Sign in with KKU SSO',
		login_redirect_note: 'You will be redirected to',

		back_home: '← Back to home'
	}
};

/**
 * @param {'th'|'en'} l
 * @param {string} key
 */
export function t(l, key) {
	return dict[l]?.[key] ?? dict.th[key] ?? key;
}
