import { describe, it, expect } from 'vitest';
import { parseHostStats, cpuPercent } from './hostStats.js';
import { parseFeedVersion } from './toolStatus.js';

describe('parseHostStats', () => {
	it('reads disk, RAM and the cgroup CPU counter', () => {
		const out = [
			'DISK /dev/mapper/vg_iscsi-vm--675--disk--0    40973536 6144168  32715832      16% /',
			'CPU 4',
			'LOAD 12.86 9.57 9.79 24/5456 2865365',
			'MEM Mem:            8192        5012        1676        2523        4026        3179',
			'CPUUSEC 751369961345',
			'NCPU 4'
		].join('\n');
		const s = parseHostStats(out);
		expect(s.disk).toEqual({ usedPct: 16, usedGb: 5.9, freeGb: 31.2, totalGb: 39.1 });
		expect(s.mem).toEqual({ usedPct: 61, usedMb: 5013, totalMb: 8192, totalGb: 8 });
		expect(s.cpus).toBe(4);
		expect(s.cpuUsec).toBe(751369961345);
		expect(s.version).toBeNull();
	});

	it('reports a full disk as 100% even with root-reserved blocks', () => {
		const s = parseHostStats('DISK /dev/x 40973536 39000000 0 100% /');
		expect(s.disk?.usedPct).toBe(100);
		expect(s.disk?.freeGb).toBe(0);
	});

	it('accepts the older CPU line and the nuclei version, tolerating missing lines', () => {
		const s = parseHostStats('VER v3.4.10\nCPU 4');
		expect(s.version).toBe('v3.4.10');
		expect(s.cpus).toBe(4);
		expect(s.cpuUsec).toBeNull();
		expect(s.disk).toBeNull();
		expect(s.mem).toBeNull();
	});
});

describe('cpuPercent', () => {
	it('is busy time over wall time across all CPUs', () => {
		// 4 CPUs for 60 s = 240 s of capacity; 60 s used → 25%.
		expect(cpuPercent({ usec: 0, at: 0 }, { usec: 60_000_000, at: 60_000 }, 4)).toBe(25);
	});

	it('returns null without a previous sample or after a counter reset', () => {
		expect(cpuPercent(undefined, { usec: 5, at: 1 }, 4)).toBeNull();
		expect(cpuPercent({ usec: 100, at: 0 }, { usec: 5, at: 60_000 }, 4)).toBeNull();
	});

	it('caps at 100', () => {
		expect(cpuPercent({ usec: 0, at: 0 }, { usec: 999_000_000, at: 1_000 }, 1)).toBe(100);
	});
});

describe('parseFeedVersion', () => {
	it('parses a GVM / Nessus feed timestamp', () => {
		expect(parseFeedVersion('202611250605')?.toISOString()).toBe('2026-11-25T06:05:00.000Z');
		expect(parseFeedVersion('20261125')?.toISOString()).toBe('2026-11-25T00:00:00.000Z');
		expect(parseFeedVersion('n/a')).toBeNull();
	});
});
