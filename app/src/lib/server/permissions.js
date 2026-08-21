/**
 * Three roles:
 *   admin — everything (manage users, AI prompt settings, upload, export, reports)
 *   soc   — upload files, export/download findings, generate AI remediation reports
 *   user  — view findings, export/download only
 */

export const ROLES = ['admin', 'soc', 'user'];

export function isValidRole(role) {
	return ROLES.includes(role);
}

export function canUpload(role) {
	return role === 'admin' || role === 'soc';
}

export function canGenerateReport(role) {
	return role === 'admin' || role === 'soc';
}

export function canExport(role) {
	return role === 'admin' || role === 'soc' || role === 'user';
}

export function canManageUsers(role) {
	return role === 'admin';
}

export function canManageSettings(role) {
	return role === 'admin';
}
