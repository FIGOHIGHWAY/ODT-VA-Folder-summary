import { describe, it, expect } from 'vitest';
import { groupFindingsByTitle } from './groupFindings.js';

describe('groupFindingsByTitle', () => {
	it('merges findings with the same title regardless of case and punctuation', () => {
		const groups = groupFindingsByTitle([
			{ title: 'Cross-site scripting (reflected)', severity: 'high', affected_url_or_port: 'https://a/x', source_tool: 'burp' },
			{ title: 'Cross Site Scripting (Reflected)', severity: 'high', affected_url_or_port: 'https://a/y', source_tool: 'zap' },
			{ title: 'Cross Site Scripting (Reflected)', severity: 'high', affected_url_or_port: 'https://a/y', source_tool: 'zap' }
		]);
		expect(groups).toHaveLength(1);
		expect(groups[0].count).toBe(3);
		expect(groups[0].targets).toEqual(['https://a/x', 'https://a/y']);
		expect(groups[0].source_tools).toEqual(['burp', 'zap']);
	});

	it('keeps the worst severity, highest CVSS, and every CVE', () => {
		const [g] = groupFindingsByTitle([
			{ title: 'PHP old', severity: 'medium', cvss_score: '5.3', cve: 'CVE-1, CVE-2' },
			{ title: 'PHP old', severity: 'critical', cvss_score: '9.8', cve: 'CVE-2' }
		]);
		expect(g.severity).toBe('critical');
		expect(g.cvss_score).toBe(9.8);
		expect(g.cves).toEqual(['CVE-1', 'CVE-2']);
	});

	it('orders by severity, then by how often the issue occurs', () => {
		const titles = groupFindingsByTitle([
			{ title: 'Low thing', severity: 'low' },
			{ title: 'Medium rare', severity: 'medium' },
			{ title: 'Medium common', severity: 'medium' },
			{ title: 'Medium common', severity: 'medium' }
		]).map((g) => g.title);
		expect(titles).toEqual(['Medium common', 'Medium rare', 'Low thing']);
	});
});
