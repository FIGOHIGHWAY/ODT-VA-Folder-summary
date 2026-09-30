const CIDR_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/;

function ipToInt(a, b, c, d) {
	return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

function intToIp(n) {
	return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

/**
 * Expand a single CIDR block (e.g. "10.1.2.0/24") into its individual host
 * IPs. Non-CIDR strings are returned as a single-item list unchanged.
 * @param {string} token
 * @param {number} maxHosts refuses to expand a block larger than this, to
 *   avoid accidentally generating tens of thousands of scan targets
 * @returns {string[]}
 */
export function expandCidrToken(token, maxHosts = 1024) {
	const m = token.match(CIDR_PATTERN);
	if (!m) return [token];

	const [, a, b, c, d, prefixStr] = m;
	const prefix = Number(prefixStr);
	if (prefix < 0 || prefix > 32) return [token];

	const hostBits = 32 - prefix;
	const total = 2 ** hostBits;
	if (total > maxHosts) {
		throw new Error(
			`${token} มีจำนวน IP มากเกินไป (${total} เครื่อง) — จำกัดไว้ที่ ${maxHosts} เครื่องต่อ CIDR block`
		);
	}

	const base = ipToInt(Number(a), Number(b), Number(c), Number(d)) & (~0 << hostBits >>> 0);
	const ips = [];
	// /31 and /32 have no network/broadcast reservation; anything wider skips them.
	const skipEdges = hostBits >= 2;
	for (let i = 0; i < total; i++) {
		if (skipEdges && (i === 0 || i === total - 1)) continue;
		ips.push(intToIp((base + i) >>> 0));
	}
	return ips;
}

/**
 * Expand a free-text target field (comma/newline separated, possibly mixing
 * plain hosts and CIDR blocks) into the full, explicit list of targets that
 * will actually be scanned.
 * @param {string} targets
 * @param {number} [maxHosts]
 * @returns {string[]}
 */
export function expandTargetList(targets, maxHosts = 1024) {
	const tokens = String(targets)
		.split(/[\n,]+/)
		.map((t) => t.trim())
		.filter(Boolean);

	const resolved = [];
	for (const token of tokens) {
		resolved.push(...expandCidrToken(token, maxHosts));
	}
	return resolved;
}

/**
 * Human-readable summary of the resolved target list, capped so a huge
 * CIDR expansion doesn't blow up the UI/DB — e.g. "10.1.2.1, 10.1.2.2, ...
 * และอีก 250 เครื่อง (รวม 254 เครื่อง)".
 * @param {string[]} resolved
 * @param {number} [previewCount]
 */
export function summarizeResolvedTargets(resolved, previewCount = 20) {
	if (resolved.length <= previewCount) return resolved.join(', ');
	const shown = resolved.slice(0, previewCount).join(', ');
	return `${shown} และอีก ${resolved.length - previewCount} เครื่อง (รวม ${resolved.length} เครื่อง)`;
}
