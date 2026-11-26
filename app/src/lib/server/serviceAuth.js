import { createHash, timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';

/**
 * Machine-to-machine access for other ODT systems (e.g. the SOC ticket engine
 * at soct.kku.ac.th) — limited to the /api/service/* routes, which can only
 * start scans and read their results. Browser users never get here: their
 * session cookie is ignored on these paths, and a service token is ignored
 * everywhere else.
 *
 * SERVICE_TOKENS lists the callers, comma-separated:
 *     name=<sha256 hex of the token>@ip1|ip2
 * Only the token's SHA-256 is stored here (generate the token on the caller,
 * hash it with `printf %s "$TOKEN" | sha256sum`). The "@ips" part is required:
 * a call must also come from one of those addresses. The address checked is
 * the last X-Forwarded-For hop — the peer nginx itself saw and appended, which
 * the caller can't forge (the app port is only reachable through nginx). So a
 * caller has to connect to this host directly, not through the front proxy.
 *
 * @typedef {{ name: string, hash: Buffer, ips: string[] }} ServiceClient
 */

/** @returns {ServiceClient[]} */
export function parseServiceTokens(raw) {
	const out = [];
	for (const part of String(raw ?? '').split(',')) {
		const m = part.trim().match(/^([a-z0-9_-]{1,40})=([0-9a-f]{64})@([0-9.|]+)$/i);
		if (!m) continue;
		const ips = m[3].split('|').filter((ip) => /^\d{1,3}(\.\d{1,3}){3}$/.test(ip));
		if (ips.length === 0) continue;
		out.push({ name: m[1].toLowerCase(), hash: Buffer.from(m[2].toLowerCase(), 'hex'), ips });
	}
	return out;
}

/** The address nginx saw (last hop of X-Forwarded-For), or null. */
export function peerAddress(forwardedFor) {
	const hops = String(forwardedFor ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
	const last = hops.at(-1) ?? null;
	return last ? last.replace(/^::ffff:/, '') : null;
}

/**
 * Authenticate a service call.
 * @param {string|null} authorization the Authorization header
 * @param {string|null} forwardedFor the X-Forwarded-For header
 * @param {ServiceClient[]} [clients]
 * @returns {{ ok: true, name: string } | { ok: false, status: number, error: string }}
 */
export function authenticateService(authorization, forwardedFor, clients = parseServiceTokens(env.SERVICE_TOKENS)) {
	if (clients.length === 0) return { ok: false, status: 404, error: 'ไม่ได้เปิดใช้ service API' };
	const m = String(authorization ?? '').match(/^Bearer\s+(\S{20,200})$/);
	if (!m) return { ok: false, status: 401, error: 'ต้องใช้ service token' };
	const hash = createHash('sha256').update(m[1]).digest();
	const client = clients.find((c) => c.hash.length === hash.length && timingSafeEqual(c.hash, hash));
	if (!client) return { ok: false, status: 401, error: 'service token ไม่ถูกต้อง' };
	const peer = peerAddress(forwardedFor);
	if (!peer || !client.ips.includes(peer)) {
		return { ok: false, status: 403, error: `ไม่อนุญาตให้เรียกจาก ${peer ?? 'ไม่ทราบที่มา'}` };
	}
	return { ok: true, name: client.name };
}
