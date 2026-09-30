import { error } from '@sveltejs/kit';
import { canUpload } from '$lib/server/permissions.js';
import { listRecentScanJobs, listIpGroups } from '$lib/server/db.js';

export async function load({ locals }) {
	if (!canUpload(locals.user?.role ?? 'user')) {
		throw error(403, 'ไม่มีสิทธิ์เข้าถึงหน้านี้');
	}
	const [jobs, ipGroups] = await Promise.all([listRecentScanJobs(), listIpGroups()]);
	return { jobs, ipGroups };
}
