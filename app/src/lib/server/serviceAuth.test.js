import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';

vi.mock('$env/dynamic/private', () => ({ env: {} }));
const { parseServiceTokens, peerAddress, authenticateService } = await import('./serviceAuth.js');

const TOKEN = 'soct-test-token-0123456789abcdef';
const HASH = createHash('sha256').update(TOKEN).digest('hex');
const clients = parseServiceTokens(`soct=${HASH}@10.101.118.169, broken=xyz@1.2.3.4, noip=${HASH}`);

describe('parseServiceTokens', () => {
	it('keeps only well-formed entries that name their source IPs', () => {
		expect(clients.map((c) => [c.name, c.ips])).toEqual([['soct', ['10.101.118.169']]]);
		expect(parseServiceTokens('')).toEqual([]);
		expect(parseServiceTokens(`a=${HASH}@10.0.0.1|10.0.0.2`)[0].ips).toEqual(['10.0.0.1', '10.0.0.2']);
	});
});

describe('peerAddress', () => {
	it('takes the last X-Forwarded-For hop (the peer nginx appended), ignoring forged earlier hops', () => {
		expect(peerAddress('1.1.1.1, 10.101.118.169')).toBe('10.101.118.169');
		expect(peerAddress('::ffff:10.101.118.169')).toBe('10.101.118.169');
		expect(peerAddress(null)).toBe(null);
	});
});

describe('authenticateService', () => {
	it('accepts the right token from an allowed address', () => {
		expect(authenticateService(`Bearer ${TOKEN}`, '10.101.118.169', clients)).toEqual({ ok: true, name: 'soct' });
	});
	it('rejects a wrong token, a missing token, and the right token from elsewhere', () => {
		expect(authenticateService('Bearer wrong-token-0123456789abcdef', '10.101.118.169', clients).status).toBe(401);
		expect(authenticateService(null, '10.101.118.169', clients).status).toBe(401);
		// forged first hop does not help: the last hop is the real peer
		const r = authenticateService(`Bearer ${TOKEN}`, '10.101.118.169, 10.101.102.34', clients);
		expect([r.ok, r.status]).toEqual([false, 403]);
	});
	it('is disabled entirely when no tokens are configured', () => {
		expect(authenticateService(`Bearer ${TOKEN}`, '10.101.118.169', []).status).toBe(404);
	});
});
