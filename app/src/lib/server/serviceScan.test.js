import { describe, it, expect, vi, beforeEach } from 'vitest';

// Live view of process.env, so each test can set the service limits it needs.
vi.mock('$env/dynamic/private', () => ({ env: process.env }));
vi.mock('./nuclei.js', () => ({ startScan: vi.fn(() => 'job-1'), peekPercent: vi.fn(() => 40), isTracked: vi.fn(() => true) }));
vi.mock('./nessus.js', () => ({ createAndLaunchScan: vi.fn(async () => ({ scanId: 77 })), getScanStatus: vi.fn(), exportScanHtml: vi.fn() }));
vi.mock('./scanFinalize.js', () => ({ finalizeNuclei: vi.fn() }));
vi.mock('./importReport.js', () => ({ parseAndInsert: vi.fn() }));
vi.mock('./db.js', () => ({
	insertScanJob: vi.fn(async () => 1),
	getScanJobByExternalId: vi.fn(),
	updateScanJobByExternalId: vi.fn(async () => {}),
	listFindingSummariesForReport: vi.fn(async () => []),
	countRunningScanJobsBy: vi.fn(async () => 0)
}));

const nuclei = await import('./nuclei.js');
const nessus = await import('./nessus.js');
const importReport = await import('./importReport.js');
const db = await import('./db.js');
const { validateTargets, startServiceScan, getServiceScan, serviceTools } = await import('./serviceScan.js');

beforeEach(() => {
	vi.clearAllMocks();
	db.countRunningScanJobsBy.mockResolvedValue(0);
	db.insertScanJob.mockResolvedValue(1);
	delete process.env.SERVICE_NESSUS_ENABLED;
	delete process.env.SERVICE_ALLOWED_NETS;
	delete process.env.SERVICE_ALLOWED_DOMAINS;
	delete process.env.SERVICE_MAX_TARGETS;
});

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

describe('scope and limits', () => {
	it('refuses targets outside the allowed ranges and domains', () => {
		expect(() => validateTargets(['8.8.8.8'])).toThrow(/นอกขอบเขต/);
		expect(() => validateTargets(['example.com'])).toThrow(/นอกขอบเขต/);
		expect(() => validateTargets(['evilkku.ac.th'])).toThrow(/นอกขอบเขต/);
		expect(() => validateTargets(['10.0.0.0/7'])).toThrow(/นอกขอบเขต/);
		expect(validateTargets(['kku.ac.th', 'a.b.kku.ac.th', '10.20.30.0/30']).targets).toHaveLength(3);
	});

	it('takes the allowed ranges and domains from the environment', () => {
		process.env.SERVICE_ALLOWED_NETS = '10.0.0.0/8,202.28.0.0/16';
		process.env.SERVICE_ALLOWED_DOMAINS = 'kku.ac.th,*.kku.edu';
		expect(validateTargets(['202.28.1.1', 'x.kku.edu']).targets).toHaveLength(2);
		expect(() => validateTargets(['202.29.1.1'])).toThrow(/นอกขอบเขต/);
	});

	it('keeps the target cap even when SERVICE_MAX_TARGETS is garbage', () => {
		process.env.SERVICE_MAX_TARGETS = 'lots';
		expect(() => validateTargets(['10.0.0.0/22'])).toThrow(/เกินกำหนด/);
	});

	it('refuses a new scan when the caller already has the maximum running', async () => {
		db.countRunningScanJobsBy.mockResolvedValue(2);
		await expect(
			startServiceScan({ tool: 'nuclei', targets: ['10.0.0.5'], cveId: 'CVE-2026-1234' }, 'soct')
		).rejects.toMatchObject({ status: 429 });
		expect(nuclei.startScan).not.toHaveBeenCalled();
	});

	it('serialises simultaneous requests from one caller so the cap holds', async () => {
		let running = 0;
		db.countRunningScanJobsBy.mockImplementation(async () => running);
		db.insertScanJob.mockImplementation(async () => {
			running += 1;
			return 1;
		});
		const req = { tool: 'nuclei', targets: ['10.0.0.5'], cveId: 'CVE-2026-1234' };
		const results = await Promise.allSettled([1, 2, 3].map(() => startServiceScan(req, 'soct')));
		expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
		expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
	});
});

describe('nessus', () => {
	it('is not offered while the license has scan_api off (default)', async () => {
		expect(serviceTools()).toEqual(['nuclei']);
		await expect(startServiceScan({ tool: 'nessus', targets: ['10.0.0.5'] }, 'soct')).rejects.toThrow(/tool/);
		expect(nessus.createAndLaunchScan).not.toHaveBeenCalled();
	});

	it('can be switched on once the license allows it', () => {
		process.env.SERVICE_NESSUS_ENABLED = '1';
		expect(serviceTools()).toEqual(['nuclei', 'nessus']);
	});

	it('serves stored findings for a finished scan instead of importing again', async () => {
		db.getScanJobByExternalId.mockResolvedValue({ status: 'done', report_id: 4, created_by: 'svc:soct' });
		const r = await getServiceScan('nessus', '77', 'soct');
		expect(r.status).toBe('done');
		expect(r.reportIds).toEqual([4]);
		expect(nessus.getScanStatus).not.toHaveBeenCalled();
		expect(importReport.parseAndInsert).not.toHaveBeenCalled();
	});
});
