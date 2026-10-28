/** Shared by server and browser: map a finding's target to a known host. */

/**
 * The bare host of a finding target — an IP or a hostname, lowercased.
 * Targets come as a bare host/IP (Nessus) or a full URL (ZAP/Burp).
 * @param {string|null|undefined} target
 * @returns {string|null}
 */
export function extractHost(target) {
	if (!target) return null;
	const s = String(target).trim();
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
		try {
			return new URL(s).hostname.toLowerCase() || null;
		} catch {
			return null;
		}
	}
	return s.split(/[/:?#]/)[0].toLowerCase() || null;
}

/** True when a string looks like a bare IPv4 address. */
export function isIpv4(host) {
	return /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(String(host ?? ''));
}

/**
 * A safe hostname for use as a Host-header override — letters, digits, dots
 * and hyphens only. Rejects anything that could inject into a shell command
 * or an HTTP header (spaces, colons, CR/LF, slashes).
 * @param {string} host
 */
export function isValidHostname(host) {
	const s = String(host ?? '');
	return s.length > 0 && s.length <= 253 && /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i.test(s);
}

/**
 * Index registry rows for fast lookup, both by IP and by hostname (a hostname
 * may have several rows — the distinct servers that share the name).
 * @param {Array<{ ip: string, hostname?: string|null, label: string, note?: string|null }>} entries
 */
export function buildHostIndex(entries = []) {
	const byIp = new Map();
	const byHostname = new Map();
	for (const e of entries) {
		const ip = String(e.ip ?? '').trim().toLowerCase();
		if (ip) byIp.set(ip, e);
		const hn = String(e.hostname ?? '').trim().toLowerCase();
		if (hn) {
			if (!byHostname.has(hn)) byHostname.set(hn, []);
			byHostname.get(hn).push(e);
		}
	}
	return { byIp, byHostname };
}

/**
 * What a finding's target maps to in the registry:
 *   - { kind: 'exact', entry }        the target is a registered IP (or host)
 *   - { kind: 'candidates', entries } the hostname maps to several servers
 *   - null                            not in the registry
 * @param {string|null} target
 * @param {{ byIp: Map, byHostname: Map }} index
 */
export function resolveHostInfo(target, index) {
	const host = extractHost(target);
	if (!host || !index) return null;
	if (index.byIp.has(host)) return { kind: 'exact', entry: index.byIp.get(host) };
	const candidates = index.byHostname.get(host);
	if (candidates && candidates.length) {
		// A hostname with exactly one registered server is itself unambiguous.
		if (candidates.length === 1) return { kind: 'exact', entry: candidates[0] };
		return { kind: 'candidates', entries: candidates };
	}
	return null;
}
