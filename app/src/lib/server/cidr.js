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

/**
 * Build a per-network breakdown for a scan whose original target field
 * listed multiple hosts/CIDR blocks — how many IPs each block covers and
 * how many of that block's hosts turned up in findings. Used to render a
 * network-by-network summary (like a manually-written scan report) instead
 * of just a flat finding list or a bare "0 findings" message.
 * @param {string} originalTargets the raw target field as typed (comma/newline separated)
 * @param {Array<{ target?: string }>} findings
 * @param {number} [maxHosts]
 * @returns {{ networks: Array<{ block: string, ipCount: number, vulnerableCount: number }>, totalIps: number, totalVulnerable: number } | null}
 *   null if the target field wasn't actually a multi-host/CIDR scan
 */
export function buildNetworkSummary(originalTargets, findings, maxHosts = 4096) {
	const blocks = String(originalTargets ?? '')
		.split(/[\n,]+/)
		.map((t) => t.trim())
		.filter(Boolean);
	if (blocks.length === 0) return null;

	const vulnerableTargets = new Set(findings.map((f) => f.target).filter(Boolean));

	const networks = blocks.map((block) => {
		let ips;
		try {
			ips = expandCidrToken(block, maxHosts);
		} catch {
			ips = [block];
		}
		const vulnerableCount = ips.filter((ip) => vulnerableTargets.has(ip)).length;
		return { block, ipCount: ips.length, vulnerableCount };
	});

	const totalIps = networks.reduce((sum, n) => sum + n.ipCount, 0);
	const isMultiHost = totalIps > 1;
	if (!isMultiHost) return null;

	return {
		networks,
		totalIps,
		totalVulnerable: networks.reduce((sum, n) => sum + n.vulnerableCount, 0)
	};
}
