import { json } from '@sveltejs/kit';
import dns from 'node:dns';
import { listHostRegistryByHostname } from '$lib/server/db.js';
import { canUpload } from '$lib/server/permissions.js';
import { isValidHostname, isIpv4 } from '$lib/hostRegistry.js';

/** Resolve the A records for a hostname, or [] if it has none / fails. */
async function resolveDns(host) {
	try {
		return await dns.promises.resolve4(host);
	} catch {
		try {
			return (await dns.promises.lookup(host, { all: true, family: 4 })).map((r) => r.address);
		} catch {
			return [];
		}
	}
}

// Given a hostname, return the servers to choose from: live DNS A records plus
// registry entries (which may include IPs that DNS does not advertise), merged.
export async function GET({ url, locals }) {
	if (!canUpload(locals.user?.role ?? 'user')) {
		return json({ error: 'ไม่มีสิทธิ์เข้าถึง' }, { status: 403 });
	}
	const host = String(url.searchParams.get('host') ?? '').trim().toLowerCase();
	if (!host || isIpv4(host) || !isValidHostname(host)) {
		return json({ error: 'ต้องระบุชื่อโฮสต์ (hostname) ให้ถูกต้อง' }, { status: 400 });
	}

	const [dnsIps, registry] = await Promise.all([resolveDns(host), listHostRegistryByHostname(host)]);
	const regByIp = new Map(registry.map((r) => [r.ip, r]));

	/** @type {Map<string, { ip: string, label: string|null, inDns: boolean, inRegistry: boolean }>} */
	const choices = new Map();
	for (const ip of dnsIps) {
		choices.set(ip, { ip, label: regByIp.get(ip)?.label ?? null, inDns: true, inRegistry: regByIp.has(ip) });
	}
	for (const r of registry) {
		if (choices.has(r.ip)) continue;
		choices.set(r.ip, { ip: r.ip, label: r.label, inDns: false, inRegistry: true });
	}

	return json({ host, dns: dnsIps, choices: [...choices.values()] });
}
