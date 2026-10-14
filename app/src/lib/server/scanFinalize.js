import { parseAndInsertZap, parseAndInsertNuclei } from './importReport.js';
import { updateScanJobByExternalId } from './db.js';

/**
 * Called by the scan modules the moment a scan settles, so results are
 * imported and the scan_jobs row updated server-side — previously that only
 * happened when an open browser tab polled the status endpoint, so closing
 * the tab before a scan finished left it stuck at "running" with its results
 * sitting unimported in memory.
 *
 * Never throws: any import failure is recorded on the scan_jobs row instead.
 * @returns {Promise<{ ok: true, result: object } | { ok: false, error: string }>}
 */
async function finalize(tool, jobId, { error, importFn }) {
	if (error) {
		await updateScanJobByExternalId(tool, jobId, { status: 'error', errorMessage: error });
		return { ok: false, error };
	}
	try {
		const { findings, ...result } = await importFn();
		await updateScanJobByExternalId(tool, jobId, {
			status: 'done',
			reportId: result.reportId ?? result.existingReportId ?? null
		});
		return { ok: true, result };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		await updateScanJobByExternalId(tool, jobId, { status: 'error', errorMessage: message }).catch(
			() => {}
		);
		return { ok: false, error: message };
	}
}

/** @param {string} jobId @param {{ alerts: object[]|null, error: string|null }} outcome */
export function finalizeZap(jobId, { alerts, error }) {
	return finalize('zap', jobId, {
		error,
		importFn: () => parseAndInsertZap(`zap-scan-${jobId}.json`, alerts ?? [])
	});
}

/** @param {string} jobId @param {{ output: string, error: string|null }} outcome */
export function finalizeNuclei(jobId, { output, error }) {
	return finalize('nuclei', jobId, {
		error,
		importFn: () => parseAndInsertNuclei(`nuclei-scan-${jobId}.jsonl`, output)
	});
}
