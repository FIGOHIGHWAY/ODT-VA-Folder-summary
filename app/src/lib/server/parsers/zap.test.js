import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseZapHtml } from './zap.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const sample = readFileSync(path.join(dir, '__fixtures__/zap_sample.html'), 'utf-8');

describe('parseZapHtml', () => {
	it('parses one entry per alert instance', () => {
		const findings = parseZapHtml(sample, 'zap_sample.html');
		expect(findings).toHaveLength(3);
	});

	it('maps the risk group id to severity and keeps confidence separately', () => {
		const findings = parseZapHtml(sample, 'zap_sample.html');
		const xss = findings.filter((f) => f.identifier === 'Cross Site Scripting (Reflected)');
		expect(xss).toHaveLength(2);
		expect(xss[0].severity).toBe('medium');
		expect(xss[0].confidence).toBe('High');

		const cookie = findings.find((f) => f.identifier === 'Cookie No HttpOnly Flag');
		expect(cookie.severity).toBe('low');
		expect(cookie.confidence).toBe('Medium');
	});

	it('extracts description, solution, target and affected URL per instance', () => {
		const findings = parseZapHtml(sample, 'zap_sample.html');
		const [first] = findings;
		expect(first.source_tool).toBe('zap');
		expect(first.target).toBe('https://app.example.com');
		expect(first.description).toMatch(/Cross-site Scripting/);
		expect(first.solution).toMatch(/Validate all input/);
		expect(first.affected_url_or_port).toBe('https://app.example.com/search?q=%3Cscript%3E');
		expect(first.cvss_score).toBeNull();
		expect(first.cve).toBeNull();
	});

	it('throws a descriptive error when no risk group list is found', () => {
		expect(() => parseZapHtml('<html><body>nothing here</body></html>', 'empty.html')).toThrow(
			/ไม่พบ alert list/
		);
	});

	it('throws a descriptive error on an unrecognized risk group id', () => {
		const broken = sample.replace('alerts--risk-2-confidence-3', 'alerts--risk-9-confidence-3');
		expect(() => parseZapHtml(broken, 'broken.html')).toThrow(/ไม่รู้จัก/);
	});
});
