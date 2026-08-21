import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { detectReportType } from './detect.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const nessus = readFileSync(path.join(dir, '__fixtures__/nessus_sample.html'), 'utf-8');
const zap = readFileSync(path.join(dir, '__fixtures__/zap_sample.html'), 'utf-8');

describe('detectReportType', () => {
	it('detects Nessus exports', () => {
		expect(detectReportType(nessus, 'nessus_sample.html')).toBe('nessus');
	});

	it('detects ZAP exports', () => {
		expect(detectReportType(zap, 'zap_sample.html')).toBe('zap');
	});

	it('throws a descriptive error for unrecognized HTML', () => {
		expect(() => detectReportType('<html><body>hello</body></html>', 'unknown.html')).toThrow(
			/ไม่พบ signature/
		);
	});
});
