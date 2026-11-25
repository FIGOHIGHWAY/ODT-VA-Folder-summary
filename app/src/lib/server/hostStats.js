/**
 * Parse the prefixed host-stats lines every scanner VM reports (the ZAP pin
 * helper's "stats" action, ~/vastat.sh on OpenVAS/Nessus, and the inline
 * command run on Nuclei):
 *   DISK <fs> <1K-blocks> <used> <avail> <use%> <mount>     (df -P /)
 *   MEM Mem: <total> <used> <free> <shared> <buff/cache> <available>   (free -m)
 *   CPUUSEC <n>   cumulative CPU time of this container's cgroup, microseconds
 *   NCPU <n>      CPUs available to it
 *   VER <s>       optional tool version (Nuclei)
 * Older helpers print "CPU <n>" instead of NCPU; both are accepted.
 * @param {string} text
 * @returns {{
 *   disk: { usedPct: number, usedGb: number, freeGb: number, totalGb: number } | null,
 *   mem: { usedPct: number, usedMb: number, totalMb: number, totalGb: number } | null,
 *   cpus: number|null, cpuUsec: number|null, version: string|null
 * }}
 */
export function parseHostStats(text) {
	const line = (prefix) =>
		String(text ?? '')
			.split('\n')
			.find((l) => l.startsWith(`${prefix} `))
			?.slice(prefix.length + 1)
			.trim() ?? null;

	let disk = null;
	const d = line('DISK')?.split(/\s+/);
	if (d && d.length >= 5) {
		const total = Number(d[1]);
		const used = Number(d[2]);
		const avail = Number(d[3]);
		if (total > 0 && Number.isFinite(used) && Number.isFinite(avail)) {
			disk = diskFromKb(used, avail, total);
		}
	}

	let mem = null;
	const m = line('MEM')?.split(/\s+/);
	if (m && m.length >= 7) {
		const total = Number(m[1]);
		const available = Number(m[6]);
		if (total > 0 && Number.isFinite(available)) mem = memFromMb(total - available, total);
	}

	const cpus = toInt(line('NCPU') ?? line('CPU'));
	const cpuUsec = toInt(line('CPUUSEC'));
	return { disk, mem, cpus, cpuUsec, version: line('VER') || null };
}

/** Disk figures from KiB counts, matching df's Use% (ignores root-reserved blocks). */
export function diskFromKb(usedKb, availKb, totalKb) {
	return {
		usedPct: Math.round((usedKb / (usedKb + availKb)) * 100),
		usedGb: round1(usedKb / 1024 / 1024),
		freeGb: round1(availKb / 1024 / 1024),
		totalGb: round1(totalKb / 1024 / 1024)
	};
}

/** Memory figures from used/total MiB ("used" excludes reclaimable cache). */
export function memFromMb(usedMb, totalMb) {
	return {
		usedPct: Math.round((usedMb / totalMb) * 100),
		usedMb: Math.round(usedMb),
		totalMb: Math.round(totalMb),
		totalGb: round1(totalMb / 1024)
	};
}

/**
 * CPU busy % between two cumulative cgroup readings.
 * @returns {number|null} 0–100, or null when it can't be computed
 */
export function cpuPercent(prev, curr, cpus) {
	if (!prev || !curr || !cpus || curr.usec == null || prev.usec == null) return null;
	const wallUs = (curr.at - prev.at) * 1000;
	const usedUs = curr.usec - prev.usec;
	if (wallUs <= 0 || usedUs < 0) return null; // counter reset (reboot) or clock skew
	return Math.min(100, Math.round((usedUs / (wallUs * cpus)) * 1000) / 10);
}

function toInt(s) {
	const n = Number.parseInt(s ?? '', 10);
	return Number.isFinite(n) ? n : null;
}

function round1(n) {
	return Math.round(n * 10) / 10;
}
