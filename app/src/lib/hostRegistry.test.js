import { describe, it, expect } from 'vitest';
import { extractHost, isIpv4, isValidHostname, buildHostIndex, resolveHostInfo } from './hostRegistry.js';

describe('isValidHostname', () => {
	it('accepts normal hostnames and rejects injection attempts', () => {
		expect(isValidHostname('web.kku.ac.th')).toBe(true);
		expect(isValidHostname('host-1')).toBe(true);
		expect(isValidHostname('bad host')).toBe(false);
		expect(isValidHostname('a;rm -rf')).toBe(false);
		expect(isValidHostname('h\r\nX: y')).toBe(false);
		expect(isValidHostname('')).toBe(false);
	});
});

describe('extractHost', () => {
	it('reads the host from a URL or a bare host', () => {
		expect(extractHost('http://10.1.1.5/path')).toBe('10.1.1.5');
		expect(extractHost('https://Web.KKU.ac.th/x?y=1')).toBe('web.kku.ac.th');
		expect(extractHost('10.1.1.5')).toBe('10.1.1.5');
		expect(extractHost('host:443')).toBe('host');
		expect(extractHost('')).toBeNull();
	});
});

describe('isIpv4', () => {
	it('recognizes bare IPv4', () => {
		expect(isIpv4('10.1.1.5')).toBe(true);
		expect(isIpv4('web.kku.ac.th')).toBe(false);
	});
});

describe('resolveHostInfo', () => {
	const index = buildHostIndex([
		{ ip: '10.1.1.10', hostname: 'web.kku.ac.th', label: 'เครื่อง A' },
		{ ip: '10.1.1.11', hostname: 'web.kku.ac.th', label: 'เครื่อง B' },
		{ ip: '10.2.2.2', hostname: 'solo.kku.ac.th', label: 'Solo' }
	]);

	it('resolves a registered IP exactly', () => {
		expect(resolveHostInfo('http://10.1.1.10/x', index)).toEqual({
			kind: 'exact',
			entry: { ip: '10.1.1.10', hostname: 'web.kku.ac.th', label: 'เครื่อง A' }
		});
	});

	it('returns every candidate server for a shared hostname', () => {
		const r = resolveHostInfo('https://web.kku.ac.th/', index);
		expect(r.kind).toBe('candidates');
		expect(r.entries.map((e) => e.label)).toEqual(['เครื่อง A', 'เครื่อง B']);
	});

	it('treats a hostname with one server as exact', () => {
		expect(resolveHostInfo('https://solo.kku.ac.th/', index).kind).toBe('exact');
	});

	it('returns null for an unknown host', () => {
		expect(resolveHostInfo('https://nope.kku.ac.th/', index)).toBeNull();
	});
});
