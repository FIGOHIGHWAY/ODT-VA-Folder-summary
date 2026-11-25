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

/**
 * @param {string} jobId
 * @param {{ alerts: object[]|null, error: string|null }} outcome
 * @param {string|null} [hostOverride] Host header the scan sent, so results file under it not the IP
 */
export function finalizeZap(jobId, { alerts, error }, hostOverride = null) {
	return finalize('zap', jobId, {
		error,
		importFn: () => parseAndInsertZap(`zap-scan-${jobId}.json`, alerts ?? [], hostOverride)
	});
}

/**
 * Import a Nuclei job's results. Each group was one nuclei run with its own
 * Host header, so each is filed under that hostname (not the IP it hit) as
 * its own report. Groups with no findings are skipped unless every group came
 * back empty, in which case one empty report records the clean scan.
 * @param {string} jobId
 * @param {{ outputs: { hostHeader: string|null, output: string }[], error: string|null }} outcome
 */
export function finalizeNuclei(jobId, { outputs, error }) {
	return finalize('nuclei', jobId, {
		error,
		importFn: async () => {
			if (outputs.length === 1) {
				const [{ hostHeader, output }] = outputs;
				return parseAndInsertNuclei(`nuclei-scan-${jobId}.jsonl`, output, hostHeader);
			}
			const withFindings = outputs.filter((o) => o.output.trim());
			const toImport = withFindings.length > 0 ? withFindings : outputs.slice(0, 1);
			const results = [];
			for (const { hostHeader, output } of toImport) {
				const suffix = hostHeader ? `-${hostHeader}` : '';
				results.push(await parseAndInsertNuclei(`nuclei-scan-${jobId}${suffix}.jsonl`, output, hostHeader));
			}
			const first = results.find((r) => r.reportId) ?? results[0];
			return {
				...first,
				insertedCount: results.reduce((sum, r) => sum + (r.insertedCount ?? 0), 0),
				reportCount: results.length,
				findings: results.flatMap((r) => r.findings ?? [])
			};
		}
	});
}
