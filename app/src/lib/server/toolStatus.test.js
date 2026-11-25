import { describe, it, expect } from 'vitest';
import { parseHostStats, parseFeedVersion } from './toolStatus.js';

describe('parseHostStats', () => {
	it('reads disk, RAM and CPU from the helper output', () => {
		const out = [
			'DISK /dev/mapper/vg_iscsi-vm--675--disk--0    40973536 6144168  32715832      16% /',
			'CPU 4',
			'LOAD 12.86 9.57 9.79 24/5456 2865365',
			'MEM Mem:            8192        5012        1676        2523        4026        3179'
		].join('\n');
		const s = parseHostStats(out);
		expect(s.disk).toEqual({ usedPct: 16, freeGb: 31.2, totalGb: 39.1 });
		expect(s.mem).toEqual({ usedPct: 61, totalGb: 8 });
		expect(s.cpus).toBe(4);
		expect(s.version).toBeNull();
	});

	it('reports a full disk as 100% even with root-reserved blocks', () => {
		const s = parseHostStats('DISK /dev/x 40973536 39000000 0 100% /');
		expect(s.disk?.usedPct).toBe(100);
		expect(s.disk?.freeGb).toBe(0);
	});

	it('reads the nuclei version and tolerates missing lines', () => {
		const s = parseHostStats('VER v3.4.10\nCPU 4');
		expect(s.version).toBe('v3.4.10');
		expect(s.disk).toBeNull();
		expect(s.mem).toBeNull();
	});
});

describe('parseFeedVersion', () => {
	it('parses a GVM feed timestamp', () => {
		expect(parseFeedVersion('202611250605')?.toISOString()).toBe('2026-11-25T06:05:00.000Z');
		expect(parseFeedVersion('20261125')?.toISOString()).toBe('2026-11-25T00:00:00.000Z');
		expect(parseFeedVersion('n/a')).toBeNull();
	});
});
