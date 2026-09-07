import { describe, expect, it } from 'vitest';
import { extractScanDateFromFilename } from './scanDate.js';

describe('extractScanDateFromFilename', () => {
	it('parses compact YYYYMMDD prefixes, with or without a trailing sequence number', () => {
		expect(extractScanDateFromFilename('20251127-nessus.html')?.toISOString().slice(0, 10)).toBe(
			'2025-11-27'
		);
		expect(extractScanDateFromFilename('2026072101-Nessus.html')?.toISOString().slice(0, 10)).toBe(
			'2026-07-21'
		);
	});

	it('parses dashed YYYY-MM-DD prefixes', () => {
		expect(
			extractScanDateFromFilename('2026-07-31-Nessus-Report-crp.computing.kku.ac.th.html')
				?.toISOString()
				.slice(0, 10)
		).toBe('2026-07-31');
	});

	it('returns null for filenames with no leading date (IP-based or hashed names)', () => {
		expect(extractScanDateFromFilename('10_101_106_133_naese1.html')).toBeNull();
		expect(extractScanDateFromFilename('agplan_kku_ac_th_c7eve9.html')).toBeNull();
	});

	it('returns null for an implausible year or invalid month/day', () => {
		expect(extractScanDateFromFilename('1999-01-01-old.html')).toBeNull();
		expect(extractScanDateFromFilename('2026139901-Nessus.html')).toBeNull();
		expect(extractScanDateFromFilename('2026023001-Nessus.html')).toBeNull(); // Feb 30 doesn't exist
	});
});
