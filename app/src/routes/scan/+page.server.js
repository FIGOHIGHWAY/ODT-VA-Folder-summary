import { error } from '@sveltejs/kit';
import { canUpload } from '$lib/server/permissions.js';
import { listRecentScanJobs, listIpGroups, updateScanJobByExternalId } from '$lib/server/db.js';
import { getScanStatus as getOpenvasStatus } from '$lib/server/openvas.js';
import { peekPercent as peekZapPercent, isTracked as isZapTracked } from '$lib/server/zap.js';
import { peekPercent as peekNucleiPercent, isTracked as isNucleiTracked } from '$lib/server/nuclei.js';

const ORPHANED_MESSAGE = 'ขาดการติดตาม: server รีสตาร์ทระหว่างสแกน — กรุณาสั่งสแกนใหม่';

// ZAP/Nuclei jobs are tracked only in this process's memory, so a restart
// mid-scan leaves their scan_jobs row "running" forever. Mark those as
// failed so the table stops showing a scan that will never finish.
async function resolveOrphanedJobs(jobs) {
	for (const job of jobs) {
		if (job.status !== 'running') continue;
		const tracked =
			job.tool === 'zap' ? isZapTracked(job.external_id)
			: job.tool === 'nuclei' ? isNucleiTracked(job.external_id)
			: true;
		if (tracked) continue;
		await updateScanJobByExternalId(job.tool, job.external_id, {
			status: 'error',
			errorMessage: ORPHANED_MESSAGE
		});
		job.status = 'error';
		job.error_message = ORPHANED_MESSAGE;
	}
}

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
						job.livePercent = peekZapPercent(job.external_id);
					} else if (job.tool === 'nuclei') {
						job.livePercent = peekNucleiPercent(job.external_id);
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
	await resolveOrphanedJobs(jobs);
	await attachLivePercent(jobs);
	return { jobs, ipGroups };
}
