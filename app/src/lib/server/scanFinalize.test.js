import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./db.js', () => ({ updateScanJobByExternalId: vi.fn(async () => {}) }));
vi.mock('./importReport.js', () => ({
	parseAndInsertZap: vi.fn(),
	parseAndInsertNuclei: vi.fn()
}));

const { updateScanJobByExternalId } = await import('./db.js');
const { parseAndInsertZap } = await import('./importReport.js');
const { finalizeZap } = await import('./scanFinalize.js');

beforeEach(() => vi.clearAllMocks());

describe('finalizeZap', () => {
	it('imports a finished scan and marks the job done with its report id', async () => {
		parseAndInsertZap.mockResolvedValue({ reportId: 42, insertedCount: 3, findings: [{}, {}, {}] });
		const outcome = await finalizeZap('job-1', { alerts: [], error: null });

		expect(outcome).toEqual({ ok: true, result: { reportId: 42, insertedCount: 3 } });
		expect(updateScanJobByExternalId).toHaveBeenCalledWith('zap', 'job-1', {
			status: 'done',
			reportId: 42
		});
	});

	it('records a scan error without trying to import', async () => {
		const outcome = await finalizeZap('job-2', { alerts: null, error: 'fetch failed' });

		expect(outcome).toEqual({ ok: false, error: 'fetch failed' });
		expect(parseAndInsertZap).not.toHaveBeenCalled();
		expect(updateScanJobByExternalId).toHaveBeenCalledWith('zap', 'job-2', {
			status: 'error',
			errorMessage: 'fetch failed'
		});
	});

	it('records an import failure as an error instead of throwing', async () => {
		parseAndInsertZap.mockRejectedValue(new Error('db down'));
		const outcome = await finalizeZap('job-3', { alerts: [], error: null });

		expect(outcome).toEqual({ ok: false, error: 'db down' });
		expect(updateScanJobByExternalId).toHaveBeenCalledWith('zap', 'job-3', {
			status: 'error',
			errorMessage: 'db down'
		});
	});
});
