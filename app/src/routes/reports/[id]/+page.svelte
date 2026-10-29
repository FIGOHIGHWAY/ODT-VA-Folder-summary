<script>
	import { goto } from '$app/navigation';
	import FindingDetail from '$lib/FindingDetail.svelte';
	import TriageBadge from '$lib/TriageBadge.svelte';
	import TriagePanel from '$lib/TriagePanel.svelte';
	import HostLabel from '$lib/HostLabel.svelte';
	import { buildHostIndex } from '$lib/hostRegistry.js';
	import { needsReviewReason } from '$lib/triage.js';

	const hostIndex = $derived(buildHostIndex(data.hosts ?? []));

	let { data } = $props();

	const SEV_RANK = { critical: 5, high: 4, medium: 3, low: 2, info: 1, informational: 1 };
	const sevRank = (s) => SEV_RANK[(s ?? '').toLowerCase()] ?? 0;

	/** triage decisions made on this page, keyed by `${domain}|${title_key}` */
	let triageUpdates = $state({});

	function applyTriage({ domain, titleKey, triage }) {
		triageUpdates = { ...triageUpdates, [`${domain}|${titleKey}`]: triage };
	}

	// Findings with any triage decision made on this page merged in.
	const findings = $derived(
		data.findings.map((f) => {
			const update = triageUpdates[`${f.triage_domain}|${f.title_key}`];
			return update ? { ...f, ...update } : f;
		})
	);

	// One row per vulnerability title (findings.title_key). A single ZAP scan can
	// report the same issue on thousands of URLs, and triage is keyed by title
	// anyway — so rendering every instance both froze the browser and buried the
	// 15 real issues. Instances are kept behind the row's expander.
	const groups = $derived(buildGroups(findings));

	function buildGroups(list) {
		/** @type {Map<string, any>} */
		const map = new Map();
		for (const f of list) {
			const key = `${f.triage_domain}|${f.title_key}`;
			let g = map.get(key);
			if (!g) {
				g = {
					key,
					title: f.title,
					title_key: f.title_key,
					triage_domain: f.triage_domain,
					triage_status: f.triage_status,
					triage_reason: f.triage_reason,
					severity: f.severity,
					identifier: f.identifier,
					cvss_score: f.cvss_score,
					cve: f.cve,
					needsReview: false,
					instances: []
				};
				map.set(key, g);
			}
			g.instances.push(f);
			if (sevRank(f.severity) > sevRank(g.severity)) g.severity = f.severity;
			if ((Number(f.cvss_score) || 0) > (Number(g.cvss_score) || 0)) g.cvss_score = f.cvss_score;
			if (f.cve && !g.cve) g.cve = f.cve;
			if (needsReviewReason(f)) g.needsReview = true;
		}
		return [...map.values()].sort(
			(a, b) => sevRank(b.severity) - sevRank(a.severity) || b.instances.length - a.instances.length
		);
	}

	/** A representative finding object carrying a group's aggregated fields. */
	function rep(g) {
		return {
			...g.instances[0],
			severity: g.severity,
			cvss_score: g.cvss_score,
			cve: g.cve,
			triage_status: g.triage_status,
			triage_reason: g.triage_reason
		};
	}

	const FILTERS = [
		{ key: 'all', label: 'ทั้งหมด', match: () => true },
		{ key: 'unreviewed', label: 'ยังไม่ตรวจ', match: (g) => !g.triage_status },
		{ key: 'review', label: '⚠ ควรตรวจซ้ำ', match: (g) => g.needsReview },
		{ key: 'false_positive', label: 'False Positive', match: (g) => g.triage_status === 'false_positive' }
	];
	let filterKey = $state('all');
	const visibleGroups = $derived(groups.filter(FILTERS.find((x) => x.key === filterKey).match));
	const countFor = (key) => groups.filter(FILTERS.find((x) => x.key === key).match).length;
	const falsePositiveCount = $derived(countFor('false_positive'));
	const totalInstances = $derived(findings.length);

	/** @type {Set<string>} group keys currently expanded */
	let expanded = $state(new Set());
	/** lazily-fetched full detail of each group's representative, keyed by finding id */
	let details = $state({});
	const MAX_INSTANCES_SHOWN = 300;

	async function toggle(g) {
		const next = new Set(expanded);
		if (next.has(g.key)) {
			next.delete(g.key);
			expanded = next;
			return;
		}
		next.add(g.key);
		expanded = next;
		// The list omits the heavy columns; pull the full detail on first open.
		const repId = g.instances[0].id;
		if (!details[repId]) {
			try {
				const res = await fetch(`/api/findings/${repId}`);
				if (res.ok) {
					const body = await res.json();
					details = { ...details, [repId]: body.finding };
				}
			} catch {
				// leave detail unloaded; the row still shows the summary fields
			}
		}
	}

	let deleteBusy = $state(false);

	async function deleteThisReport() {
		if (
			!confirm(
				`ลบ report #${data.reportId} ทิ้งถาวร? ข้อมูล finding และไฟล์ต้นฉบับ (ถ้ามี) จะหายไปเลย กู้คืนไม่ได้`
			)
		) {
			return;
		}
		deleteBusy = true;
		try {
			const res = await fetch(`/api/reports/${data.reportId}`, { method: 'DELETE' });
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				alert(body.error ?? 'ลบไม่สำเร็จ');
				return;
			}
			goto('/');
		} finally {
			deleteBusy = false;
		}
	}
</script>

<svelte:head>
	<title>Report #{data.reportId} · Scan Report Normalizer</title>
</svelte:head>

<div class="wrap">
	<p class="eyebrow"><a href="/">← กลับหน้าแรก</a></p>
	<div style="display:flex; justify-content:space-between; align-items:flex-start; gap:1rem">
		<div>
			<h1>Report #{data.reportId}</h1>
			<p class="sub">
				{groups.length} หัวข้อ · พบทั้งหมด {totalInstances.toLocaleString()} จุด
				{#if falsePositiveCount > 0}(False Positive {falsePositiveCount} หัวข้อ){/if}
				{#if groups.length > 0}— คลิกแถวเพื่อดูรายละเอียด จุดที่พบ และบันทึกผลตรวจสอบ{/if}
			</p>
			<p class="meta">
				<span class="badge">{data.meta.source_tool.toUpperCase()}</span>
				{#if data.meta.scan_target}
					<span class="mono">🎯 {data.meta.scan_target}</span>
				{:else if data.meta.domain}
					<span class="mono">🎯 {data.meta.domain}</span>
				{/if}
				{#if data.meta.scan_extra}
					<span class="mono">({data.meta.scan_extra})</span>
				{/if}
				<span>สแกนเมื่อ {new Date(data.meta.scanned_at ?? data.meta.imported_at).toLocaleString('th-TH')}</span>
			</p>
			{#if data.meta.scan_resolved_targets}
				<p class="meta resolved-targets">
					<span>📋 IP ที่สแกนไปทั้งหมด:</span>
					<span class="mono">{data.meta.scan_resolved_targets}</span>
				</p>
			{/if}
		</div>
		<div style="display:flex; gap:.5rem">
			<a class="button" href="/api/export/report/{data.reportId}">⬇️ ดึงไฟล์ (PDF)</a>
			{#if data.hasOriginal}
				<a class="button" href="/api/reports/{data.reportId}/preview" target="_blank" rel="noopener">
					👁️ ดูตัวอย่าง
				</a>
				<a class="button" href="/api/reports/{data.reportId}/original">⬇️ ไฟล์ต้นฉบับ</a>
			{/if}
			{#if data.canDelete}
				<button type="button" class="button button-danger" disabled={deleteBusy} onclick={deleteThisReport}>
					🗑️ ลบ report นี้
				</button>
			{/if}
		</div>
	</div>

	{#if data.networkSummary}
		<div class="panel">
			<h2 class="summary-h2">📊 สรุปผลรายเครือข่าย</h2>
			<div class="summary-cards">
				<div class="scard"><div class="n">{data.networkSummary.networks.length}</div><div class="l">เครือข่ายที่สแกน</div></div>
				<div class="scard"><div class="n">{data.networkSummary.totalIps.toLocaleString()}</div><div class="l">IP ที่สแกนทั้งหมด</div></div>
				<div class="scard" class:vuln={data.networkSummary.totalVulnerable > 0}>
					<div class="n">{data.networkSummary.totalVulnerable}</div><div class="l">โฮสต์ที่พบช่องโหว่</div>
				</div>
			</div>
			<table>
				<thead>
					<tr>
						<th>เครือข่าย (CIDR)</th>
						<th>จำนวน IP</th>
						<th>ผลตรวจ</th>
					</tr>
				</thead>
				<tbody>
					{#each data.networkSummary.networks as net (net.block)}
						<tr>
							<td class="mono">{net.block}</td>
							<td class="mono">{net.ipCount.toLocaleString()}</td>
							<td>
								{#if net.vulnerableCount > 0}
									<span class="badge err">พบช่องโหว่ {net.vulnerableCount} โฮสต์</span>
								{:else}
									<span class="badge ok">ไม่พบช่องโหว่</span>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}

	<div class="panel">
		{#if data.findings.length === 0}
			<div class="empty">
				<div>
					✅ สแกน{#if data.meta.scan_target}
						<span class="mono">{data.meta.scan_target}</span>
					{:else}
						target นี้
					{/if}{#if data.meta.scan_extra}
						<span class="mono">({data.meta.scan_extra})</span>
					{/if} ด้วย {data.meta.source_tool.toUpperCase()} แล้ว — ไม่พบช่องโหว่
				</div>
				{#if data.meta.scan_resolved_targets}
					<div class="resolved-targets-detail">
						📋 IP ที่สแกนไปทั้งหมด: <span class="mono">{data.meta.scan_resolved_targets}</span>
					</div>
				{/if}
			</div>
		{:else}
			<div class="filter-row">
				{#each FILTERS as fl (fl.key)}
					<button
						type="button"
						class="chip"
						class:active={filterKey === fl.key}
						onclick={() => (filterKey = fl.key)}>{fl.label} ({countFor(fl.key)})</button
					>
				{/each}
			</div>
			<div class="scroll">
				<table>
					<thead>
						<tr>
							<th></th>
							<th>Severity</th>
							<th>Identifier</th>
							<th>Title</th>
							<th>จุดที่พบ</th>
							<th>CVSS</th>
							<th>CVE</th>
						</tr>
					</thead>
					<tbody>
						{#each visibleGroups as g (g.key)}
							{@const isOpen = expanded.has(g.key)}
							{@const r = rep(g)}
							<tr
								class="finding-row"
								class:is-fp={g.triage_status === 'false_positive'}
								onclick={() => toggle(g)}
								aria-expanded={isOpen}
							>
								<td class="caret-cell">
									<span class="caret" class:open={isOpen}>▸</span>
								</td>
								<td><span class="sev {g.severity}">{g.severity}</span></td>
								<td class="mono">{g.identifier}</td>
								<td>{g.title}<TriageBadge finding={r} /></td>
								<td class="mono" style="max-width:260px;word-break:break-word">
									{#if g.instances.length > 1}
										<span class="count-badge">{g.instances.length.toLocaleString()} จุด</span>
									{:else}
										{g.instances[0].affected_url_or_port ?? g.instances[0].target ?? ''}<HostLabel
											finding={g.instances[0]}
											index={hostIndex}
										/>
									{/if}
								</td>
								<td class="mono" style="font-variant-numeric:tabular-nums">
									{g.cvss_score ?? '—'}
								</td>
								<td class="mono">{g.cve ?? '—'}</td>
							</tr>
							{#if isOpen}
								<tr class="detail-row">
									<td colspan="7">
										<TriagePanel finding={r} canTriage={data.canTriage} onchange={applyTriage} />
										{#if details[g.instances[0].id]}
											<FindingDetail finding={details[g.instances[0].id]} />
										{:else}
											<p class="loading">กำลังโหลดรายละเอียด…</p>
										{/if}
										{#if g.instances.length > 1}
											<div class="instances">
												<div class="instances-h">
													จุดที่พบทั้งหมด ({g.instances.length.toLocaleString()})
												</div>
												<ul>
													{#each g.instances.slice(0, MAX_INSTANCES_SHOWN) as inst (inst.id)}
														<li class="mono">{inst.affected_url_or_port ?? inst.target ?? '—'}</li>
													{/each}
												</ul>
												{#if g.instances.length > MAX_INSTANCES_SHOWN}
													<div class="instances-more">
														…และอีก {(g.instances.length - MAX_INSTANCES_SHOWN).toLocaleString()} รายการ
														(ดูครบในไฟล์ PDF/ต้นฉบับ)
													</div>
												{/if}
											</div>
										{/if}
									</td>
								</tr>
							{/if}
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>
</div>

<style>
	.summary-h2 {
		font-size: 1rem;
		margin: 0 0 0.9rem;
	}
	.summary-cards {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 0.75rem;
		margin-bottom: 1.25rem;
	}
	.scard {
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 0.9rem 1rem;
	}
	.scard .n {
		font-size: 1.6rem;
		font-weight: 700;
		line-height: 1;
	}
	.scard .l {
		font-size: 0.78rem;
		color: var(--muted);
		margin-top: 0.35rem;
	}
	.scard.vuln .n {
		color: #f19a9a;
	}
	@media (max-width: 560px) {
		.summary-cards {
			grid-template-columns: repeat(2, 1fr);
		}
	}
	.meta {
		display: flex;
		gap: 0.6rem;
		align-items: center;
		flex-wrap: wrap;
		color: var(--muted);
		font-size: 0.85rem;
		margin-top: 0.35rem;
	}
	.meta.resolved-targets {
		align-items: flex-start;
	}
	.meta.resolved-targets .mono {
		word-break: break-word;
	}
	.resolved-targets-detail {
		margin-top: 0.75rem;
		color: var(--muted);
		font-size: 0.85rem;
		word-break: break-word;
	}
	.finding-row {
		cursor: pointer;
	}
	.finding-row.is-fp td {
		opacity: 0.5;
	}
	.filter-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-bottom: 0.9rem;
	}
	.chip {
		background: var(--code-bg);
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 0.25rem 0.75rem;
		font: inherit;
		font-size: 0.78rem;
		color: var(--text);
		cursor: pointer;
	}
	.chip.active {
		background: var(--accent);
		border-color: var(--accent);
		color: #fff;
	}
	.finding-row:hover td {
		background: rgba(37, 99, 235, 0.06);
	}
	.caret-cell {
		width: 1.5rem;
	}
	.caret {
		display: inline-block;
		color: var(--muted);
		font-size: 0.8em;
		transition: transform 0.15s;
	}
	.caret.open {
		transform: rotate(90deg);
	}
	.detail-row td {
		background: var(--code-bg);
		padding: 1rem 1.25rem;
	}
	.count-badge {
		display: inline-block;
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		background: var(--code-bg);
		border: 1px solid var(--border);
		font-size: 0.78rem;
		color: var(--text);
	}
	.loading {
		color: var(--muted);
		font-size: 0.85rem;
		margin: 0.75rem 0;
	}
	.instances {
		margin-top: 1rem;
		border-top: 1px solid var(--border);
		padding-top: 0.75rem;
	}
	.instances-h {
		font-size: 0.78rem;
		color: var(--muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-bottom: 0.5rem;
	}
	.instances ul {
		margin: 0;
		padding: 0;
		list-style: none;
		max-height: 320px;
		overflow-y: auto;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--panel);
	}
	.instances li {
		padding: 0.3rem 0.6rem;
		font-size: 0.8rem;
		word-break: break-word;
		border-bottom: 1px solid var(--border);
	}
	.instances li:last-child {
		border-bottom: none;
	}
	.instances-more {
		margin-top: 0.5rem;
		font-size: 0.8rem;
		color: var(--muted);
	}
</style>
