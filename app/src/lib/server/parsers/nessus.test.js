import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseNessusHtml } from './nessus.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const sample = readFileSync(path.join(dir, '__fixtures__/nessus_sample.html'), 'utf-8');

describe('parseNessusHtml', () => {
	it('parses every finding, keeping duplicate plugin ids (no auto-dedupe)', () => {
		const findings = parseNessusHtml(sample, 'nessus_sample.html');
		expect(findings).toHaveLength(4);
	});

	it('maps background color to severity correctly', () => {
		const findings = parseNessusHtml(sample, 'nessus_sample.html');
		const bySeverity = Object.fromEntries(findings.map((f) => [f.identifier, f.severity]));
		expect(bySeverity['10114']).toBe('critical');
		expect(bySeverity['22964']).toBe('high');
		expect(bySeverity['19506']).toBe('info');
	});

	it('extracts title, target, description, solution, cvss and cve', () => {
		const [first] = parseNessusHtml(sample, 'nessus_sample.html');
		expect(first.source_tool).toBe('nessus');
		expect(first.target).toBe('webserver01.example.com');
		expect(first.identifier).toBe('10114');
		expect(first.title).toBe('ICMP Timestamp Request Remote Date Disclosure');
		expect(first.description).toMatch(/ICMP timestamp requests/);
		expect(first.solution).toMatch(/Filter out ICMP/);
		expect(first.cvss_score).toBe(9.8);
		expect(first.cve).toBe('CVE-2020-12345');
	});

	it('does not dedupe repeated plugin ids across ports/instances', () => {
		const findings = parseNessusHtml(sample, 'nessus_sample.html');
		const dupes = findings.filter((f) => f.identifier === '19506');
		expect(dupes).toHaveLength(2);
		expect(dupes[0].description).not.toBe(dupes[1].description);
	});

	it('throws a descriptive error when the target hostname block is missing', () => {
		const broken = sample.replace('font-size:22px;font-weight:700', '');
		expect(() => parseNessusHtml(broken, 'broken.html')).toThrow(/target hostname/);
	});

	it('throws a descriptive error on an unmapped severity color', () => {
		const broken = sample.replace('#91243E', '#123456');
		expect(() => parseNessusHtml(broken, 'broken.html')).toThrow(/สีที่ไม่รู้จัก/);
	});
});
