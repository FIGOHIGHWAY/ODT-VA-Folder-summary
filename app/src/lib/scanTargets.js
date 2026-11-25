/**
 * Shared by the scan form (live preview) and the scan API routes (the real
 * parse), so what the user sees is exactly what gets scanned.
 *
 * A target field holds one entry per line, or several per line separated by
 * commas. An entry may be a single target, or a "name + IP" pair separated by
 * whitespace (either order), e.g.
 *
 *     https://web1.kku.ac.th 10.1.1.5
 *     10.1.1.6 web2.kku.ac.th
 *
 * A pair means "this vhost lives on this server": ZAP scans the name with DNS
 * pinned to the IP; Nuclei hits the IP and sends the name as the Host header.
 */
import { extractHost, isIpv4, isValidHostname } from './hostRegistry.js';

/**
 * Split a raw field into entries of one or two whitespace-separated tokens.
 * @param {string} raw
 * @returns {{ entries: string[][], errors: string[] }}
 */
function splitEntries(raw) {
	const entries = [];
	const errors = [];
	for (const piece of String(raw ?? '').split(/[\n,]+/)) {
		const tokens = piece.trim().split(/\s+/).filter(Boolean);
		if (tokens.length === 0) continue;
		if (tokens.length > 2) {
			errors.push(`"${piece.trim()}": ใส่ได้บรรทัดละ 1 เป้าหมาย หรือ 1 คู่ "ชื่อ IP" เท่านั้น`);
			continue;
		}
		entries.push(tokens);
	}
	return { entries, errors };
}

/** For a two-token entry, return [ip, other] when exactly one token is an IPv4. */
function pairIp(tokens) {
	const [a, b] = tokens;
	if (isIpv4(a) && !isIpv4(b)) return [a, b];
	if (isIpv4(b) && !isIpv4(a)) return [b, a];
	return null;
}

/**
 * ZAP: every entry is a URL; a pair adds a DNS pin for that URL's host.
 * A bare name in a pair gets https:// prepended for convenience.
 * @param {string} raw
 * @returns {{ urls: string[], pins: { host: string, ip: string }[], errors: string[] }}
 */
export function parseZapTargets(raw) {
	const { entries, errors } = splitEntries(raw);
	const urls = [];
	/** @type {Map<string, string>} host → ip */
	const pinMap = new Map();

	for (const tokens of entries) {
		if (tokens.length === 1) {
			const url = tokens[0];
			if (!/^https?:\/\//i.test(url)) {
				errors.push(`"${url}": ZAP ต้องการ URL เต็มรูปแบบ เช่น https://example.kku.ac.th`);
				continue;
			}
			urls.push(url);
			continue;
		}

		const pair = pairIp(tokens);
		if (!pair) {
			errors.push(`"${tokens.join(' ')}": คู่ต้องเป็น ชื่อเว็บ + IP อย่างละ 1 ค่า`);
			continue;
		}
		const [ip, other] = pair;
		const url = /^https?:\/\//i.test(other) ? other : `https://${other}`;
		const host = extractHost(url);
		if (!host || isIpv4(host) || !isValidHostname(host)) {
			errors.push(`"${tokens.join(' ')}": ปัก DNS ได้เฉพาะชื่อเว็บ ไม่ใช่ IP`);
			continue;
		}
		const existing = pinMap.get(host);
		if (existing && existing !== ip) {
			errors.push(`${host} ถูกปักไว้ 2 IP (${existing} และ ${ip}) ในงานเดียวกันไม่ได้ ให้แยกเป็นคนละงาน`);
			continue;
		}
		pinMap.set(host, ip);
		urls.push(url);
	}

	// A host pinned on one line also applies to other lines with the same host.
	const pins = [...pinMap].map(([host, ip]) => ({ host, ip }));
	return { urls: [...new Set(urls)], pins, errors };
}

/**
 * Nuclei: a pair means "hit the IP (or URL) with this Host header". Targets
 * are grouped by Host header since nuclei's -H applies to a whole run.
 * Single entries use `defaultHostHeader` (may be null).
 * @param {string} raw
 * @param {string|null} [defaultHostHeader]
 * @returns {{ groups: { hostHeader: string|null, targets: string[] }[], targets: string[], errors: string[] }}
 */
export function parseNucleiTargets(raw, defaultHostHeader = null) {
	const { entries, errors } = splitEntries(raw);
	/** @type {Map<string, string[]>} hostHeader ('' = none) → targets */
	const byHeader = new Map();
	const add = (header, target) => {
		const key = header ?? '';
		if (!byHeader.has(key)) byHeader.set(key, []);
		const list = byHeader.get(key);
		if (!list.includes(target)) list.push(target);
	};

	for (const tokens of entries) {
		if (tokens.length === 1) {
			add(defaultHostHeader, tokens[0]);
			continue;
		}
		// The Host header is the token that is a plain hostname (not an IP or URL);
		// the target is the other one.
		const [a, b] = tokens;
		const isName = (t) => !isIpv4(t) && !/^[a-z][a-z0-9+.-]*:\/\//i.test(t) && isValidHostname(t);
		let header;
		let target;
		if (isName(a) && !isName(b)) [header, target] = [a, b];
		else if (isName(b) && !isName(a)) [header, target] = [b, a];
		else {
			errors.push(`"${tokens.join(' ')}": คู่ต้องเป็น IP (หรือ URL) + ชื่อเว็บ อย่างละ 1 ค่า`);
			continue;
		}
		add(header.toLowerCase(), target);
	}

	const groups = [...byHeader].map(([key, targets]) => ({ hostHeader: key || null, targets }));
	return { groups, targets: groups.flatMap((g) => g.targets), errors };
}
