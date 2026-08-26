import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseBurpHtml } from './burp.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const sample = readFileSync(path.join(dir, '__fixtures__/burp_sample.html'), 'utf-8');

describe('parseBurpHtml', () => {
	it('parses one entry per BODH0 issue heading', () => {
		const findings = parseBurpHtml(sample, 'burp_sample.html');
		expect(findings).toHaveLength(2);
	});

	it('maps severity, confidence, host and path per issue', () => {
		const findings = parseBurpHtml(sample, 'burp_sample.html');
		const cors = findings.find((f) => f.title.startsWith('Cross-origin'));
		expect(cors.severity).toBe('high');
		expect(cors.confidence).toBe('Certain');
		expect(cors.target).toBe('https://app.example.com');
		expect(cors.affected_url_or_port).toBe('https://app.example.com/api/v1');

		const cacheable = findings.find((f) => f.title.startsWith('Cacheable'));
		expect(cacheable.severity).toBe('info');
	});

	it('extracts identifier from the knowledgebase link slug, description and solution', () => {
		const [first] = parseBurpHtml(sample, 'burp_sample.html');
		expect(first.source_tool).toBe('burp');
		expect(first.identifier).toBe('00200601_crossoriginresourcesharingarbitraryorigintrusted');
		expect(first.description).toMatch(/allows access from any domain/);
		expect(first.solution).toMatch(/whitelist of trusted domains/);
		expect(first.cvss_score).toBeNull();
		expect(first.cve).toBeNull();
	});

	it('throws a descriptive error when no BODH0 headings are found', () => {
		expect(() => parseBurpHtml('<html><body>nothing here</body></html>', 'empty.html')).toThrow(
			/ไม่พบ issue heading/
		);
	});

	it('throws a descriptive error on an unrecognized severity value', () => {
		const broken = sample.replace('<b>High</b>', '<b>Critical</b>');
		expect(() => parseBurpHtml(broken, 'broken.html')).toThrow(/ไม่รู้จัก/);
	});
});
