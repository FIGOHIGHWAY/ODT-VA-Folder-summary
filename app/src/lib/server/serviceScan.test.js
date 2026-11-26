import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./nuclei.js', () => ({ startScan: vi.fn(() => 'job-1'), peekPercent: vi.fn(() => 40), isTracked: vi.fn(() => true) }));
vi.mock('./nessus.js', () => ({ createAndLaunchScan: vi.fn(async () => ({ scanId: 77 })), getScanStatus: vi.fn(), exportScanHtml: vi.fn() }));
vi.mock('./scanFinalize.js', () => ({ finalizeNuclei: vi.fn() }));
vi.mock('./importReport.js', () => ({ parseAndInsert: vi.fn() }));
vi.mock('./db.js', () => ({
	insertScanJob: vi.fn(async () => 1),
	getScanJobByExternalId: vi.fn(),
	updateScanJobByExternalId: vi.fn(async () => {}),
	listFindingSummariesForReport: vi.fn(async () => [])
}));

const nuclei = await import('./nuclei.js');
const db = await import('./db.js');
const { validateTargets, startServiceScan, getServiceScan } = await import('./serviceScan.js');

beforeEach(() => vi.clearAllMocks());

describe('validateTargets', () => {
	it('accepts IPs, CIDR and hostnames, de-duplicated', () => {
		const r = validateTargets(['10.0.0.1', 'www.kku.ac.th', '10.0.0.1', '10.0.1.0/30']);
		expect(r.targets).toEqual(['10.0.0.1', 'www.kku.ac.th', '10.0.1.0/30']);
		expect(r.resolved).toHaveLength(4);
	});
	it('rejects shell metacharacters, empty lists and oversized sweeps', () => {
		expect(() => validateTargets(['10.0.0.1; rm -rf /'])).toThrow();
		expect(() => validateTargets([])).toThrow();
		expect(() => validateTargets(['10.0.0.0/22'])).toThrow(/เกินกำหนด/);
	});
});

describe('startServiceScan', () => {
	it('starts a CVE-targeted nuclei scan recorded under the caller', async () => {
		const r = await startServiceScan({ tool: 'nuclei', targets: ['10.0.0.5'], cveId: 'cve-2026-123007', label: 'campaign 3' }, 'soct');
		expect(r).toEqual({ tool: 'nuclei', jobId: 'job-1' });
		expect(nuclei.startScan.mock.calls[0][0]).toEqual([{ hostHeader: null, targets: ['10.0.0.5'] }]);
		expect(nuclei.startScan.mock.calls[0][1]).toBe('CVE-2026-123007');
		expect(db.insertScanJob.mock.calls[0][0]).toMatchObject({ tool: 'nuclei', createdBy: 'svc:soct', externalId: 'job-1' });
	});
	it('refuses nuclei without a CVE and unknown tools', async () => {
		await expect(startServiceScan({ tool: 'nuclei', targets: ['10.0.0.5'] }, 'soct')).rejects.toThrow(/cveId/);
		await expect(startServiceScan({ tool: 'zap', targets: ['10.0.0.5'] }, 'soct')).rejects.toThrow();
	});
});

describe('getServiceScan', () => {
	it("only shows the caller's own jobs", async () => {
		db.getScanJobByExternalId.mockResolvedValue({ status: 'running', created_by: 'phonhat@kku.ac.th' });
		expect(await getServiceScan('nuclei', 'job-1', 'soct')).toBeNull();
	});
	it('reports progress, then findings once done', async () => {
		db.getScanJobByExternalId.mockResolvedValue({ status: 'running', created_by: 'svc:soct' });
		expect(await getServiceScan('nuclei', 'job-1', 'soct')).toEqual({ status: 'running', percent: 40 });
		db.getScanJobByExternalId.mockResolvedValue({ status: 'done', report_id: 9, created_by: 'svc:soct' });
		db.listFindingSummariesForReport.mockResolvedValue([{ target: '10.0.0.5', title: 'x', severity: 'critical', cve: 'CVE-2026-123007', cvss_score: '9.2' }]);
		const r = await getServiceScan('nuclei', 'job-1', 'soct');
		expect(r.status).toBe('done');
		expect(r.findings[0]).toMatchObject({ target: '10.0.0.5', cvss_score: 9.2, report_id: 9 });
	});
	it('marks a job lost to a restart as failed', async () => {
		db.getScanJobByExternalId.mockResolvedValue({ status: 'running', created_by: 'svc:soct' });
		nuclei.isTracked.mockReturnValueOnce(false);
		expect((await getServiceScan('nuclei', 'job-1', 'soct')).status).toBe('error');
	});
});
