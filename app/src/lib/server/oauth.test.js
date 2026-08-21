import { describe, expect, it, beforeEach, vi } from 'vitest';

describe('isEmailAllowed', () => {
	beforeEach(() => {
		vi.resetModules();
	});

	it('allows everyone when ALLOWED_EMAILS is unset', async () => {
		vi.doMock('$env/dynamic/private', () => ({ env: {} }));
		const { isEmailAllowed } = await import('./oauth.js');
		expect(isEmailAllowed('anyone@example.com')).toBe(true);
		expect(isEmailAllowed(null)).toBe(true);
	});

	it('only allows emails in the comma-separated allowlist, case-insensitively', async () => {
		vi.doMock('$env/dynamic/private', () => ({
			env: { ALLOWED_EMAILS: 'phonhat@kku.ac.th, someone.else@kku.ac.th' }
		}));
		const { isEmailAllowed } = await import('./oauth.js');
		expect(isEmailAllowed('phonhat@kku.ac.th')).toBe(true);
		expect(isEmailAllowed('PHONHAT@KKU.AC.TH')).toBe(true);
		expect(isEmailAllowed('someone.else@kku.ac.th')).toBe(true);
		expect(isEmailAllowed('random@kku.ac.th')).toBe(false);
		expect(isEmailAllowed(null)).toBe(false);
	});
});
