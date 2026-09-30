import { error } from '@sveltejs/kit';
import { canUpload } from '$lib/server/permissions.js';
import { listRecentScanJobs, listIpGroups } from '$lib/server/db.js';
import { getScanStatus as getOpenvasStatus } from '$lib/server/openvas.js';
import { getScanStatus as getZapStatus } from '$lib/server/zap.js';

// Fetches a live progress percentage for jobs the history table shows as
// still running, since scan_jobs itself only tracks status, not progress.
async function attachLivePercent(jobs) {
	await Promise.all(
		jobs
			.filter((job) => job.status === 'running')
			.map(async (job) => {
				try {
					if (job.tool === 'openvas') {
						const { percent } = await getOpenvasStatus(job.external_id);
						job.livePercent = percent;
					} else if (job.tool === 'zap') {
						const status = getZapStatus(job.external_id);
						job.livePercent = status.status === 'running' ? status.percent : null;
					}
				} catch {
					// Best effort — leave livePercent unset if the tool's API/tunnel
					// happens to be unreachable right now.
				}
			})
	);
	return jobs;
}

export async function load({ locals }) {
	if (!canUpload(locals.user?.role ?? 'user')) {
		throw error(403, 'ไม่มีสิทธิ์เข้าถึงหน้านี้');
	}
	const [jobs, ipGroups] = await Promise.all([listRecentScanJobs(), listIpGroups()]);
	await attachLivePercent(jobs);
	return { jobs, ipGroups };
}
