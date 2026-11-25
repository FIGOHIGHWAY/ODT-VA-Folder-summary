import { describe, it, expect } from 'vitest';
import { parseZapTargets, parseNucleiTargets } from './scanTargets.js';

describe('parseZapTargets', () => {
	it('keeps plain URLs and accepts commas or newlines', () => {
		const r = parseZapTargets('https://a.kku.ac.th, https://b.kku.ac.th\nhttps://c.kku.ac.th');
		expect(r.urls).toEqual(['https://a.kku.ac.th', 'https://b.kku.ac.th', 'https://c.kku.ac.th']);
		expect(r.pins).toEqual([]);
		expect(r.errors).toEqual([]);
	});

	it('turns name + IP pairs into pins, in either order', () => {
		const r = parseZapTargets('https://web1.kku.ac.th 10.1.1.5\n10.1.1.6 web2.kku.ac.th');
		expect(r.urls).toEqual(['https://web1.kku.ac.th', 'https://web2.kku.ac.th']);
		expect(r.pins).toEqual([
			{ host: 'web1.kku.ac.th', ip: '10.1.1.5' },
			{ host: 'web2.kku.ac.th', ip: '10.1.1.6' }
		]);
		expect(r.errors).toEqual([]);
	});

	it('pins a URL with a path by its host', () => {
		const r = parseZapTargets('https://web1.kku.ac.th/app/ 10.1.1.5');
		expect(r.urls).toEqual(['https://web1.kku.ac.th/app/']);
		expect(r.pins).toEqual([{ host: 'web1.kku.ac.th', ip: '10.1.1.5' }]);
	});

	it('rejects bare names without a pair, conflicting pins and IP-only pairs', () => {
		expect(parseZapTargets('a.kku.ac.th').errors).toHaveLength(1);
		expect(parseZapTargets('https://a.kku.ac.th 10.0.0.1\nhttps://a.kku.ac.th 10.0.0.2').errors).toHaveLength(1);
		expect(parseZapTargets('10.0.0.1 10.0.0.2').errors).toHaveLength(1);
		expect(parseZapTargets('https://a.kku.ac.th 10.0.0.1 extra').errors).toHaveLength(1);
	});
});

describe('parseNucleiTargets', () => {
	it('puts single targets in one group with the default header', () => {
		const r = parseNucleiTargets('10.1.1.1, 10.1.1.2', 'web.kku.ac.th');
		expect(r.groups).toEqual([{ hostHeader: 'web.kku.ac.th', targets: ['10.1.1.1', '10.1.1.2'] }]);
	});

	it('groups pairs by Host header, either order', () => {
		const r = parseNucleiTargets('10.1.1.5 web1.kku.ac.th\nWEB2.kku.ac.th 10.1.1.6\n10.1.1.7');
		expect(r.groups).toEqual([
			{ hostHeader: 'web1.kku.ac.th', targets: ['10.1.1.5'] },
			{ hostHeader: 'web2.kku.ac.th', targets: ['10.1.1.6'] },
			{ hostHeader: null, targets: ['10.1.1.7'] }
		]);
		expect(r.targets).toEqual(['10.1.1.5', '10.1.1.6', '10.1.1.7']);
		expect(r.errors).toEqual([]);
	});

	it('accepts a URL target with a Host header', () => {
		const r = parseNucleiTargets('https://10.1.1.5:8443 web1.kku.ac.th');
		expect(r.groups).toEqual([{ hostHeader: 'web1.kku.ac.th', targets: ['https://10.1.1.5:8443'] }]);
	});

	it('rejects pairs of two names or two IPs', () => {
		expect(parseNucleiTargets('a.kku.ac.th b.kku.ac.th').errors).toHaveLength(1);
		expect(parseNucleiTargets('10.0.0.1 10.0.0.2').errors).toHaveLength(1);
	});
});
