import { describe, it, expect } from 'vitest';
import { rpConfig, __test } from './webauthn.js';

const { normalizeCode, hashCode, makeCode } = __test;

describe('recovery code helpers', () => {
	it('normalizes by dropping separators and case', () => {
		expect(normalizeCode('K7M2-9QX4-AB3N')).toBe('k7m29qx4ab3n');
		expect(normalizeCode('k7m2 9qx4 ab3n')).toBe('k7m29qx4ab3n');
	});

	it('hashes equal for the same code regardless of formatting', () => {
		expect(hashCode('K7M2-9QX4-AB3N')).toBe(hashCode('k7m29qx4ab3n'));
		expect(hashCode('aaaa-bbbb-cccc')).not.toBe(hashCode('aaaa-bbbb-cccd'));
	});

	it('generates codes grouped in 4s with no look-alike characters', () => {
		const code = makeCode();
		expect(code).toMatch(/^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/);
		expect(code).not.toMatch(/[il1o0]/); // excluded ambiguous chars
	});

	it('generates distinct codes', () => {
		const codes = new Set(Array.from({ length: 50 }, makeCode));
		expect(codes.size).toBe(50);
	});
});

describe('rpConfig', () => {
	it('defaults the origin from the RP ID', () => {
		const { rpID, origin } = rpConfig();
		expect(origin).toBe(`https://${rpID}`);
	});
});
