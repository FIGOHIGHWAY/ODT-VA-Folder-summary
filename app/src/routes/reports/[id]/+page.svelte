<script>
	import { goto } from '$app/navigation';
	import FindingDetail from '$lib/FindingDetail.svelte';
	import TriageBadge from '$lib/TriageBadge.svelte';
	import TriagePanel from '$lib/TriagePanel.svelte';
	import { needsReviewReason } from '$lib/triage.js';

	let { data } = $props();

	/** @type {Set<number>} finding ids currently expanded to show full detail */
	let expanded = $state(new Set());

	function toggle(id) {
		const next = new Set(expanded);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		expanded = next;
	}

	/** triage decisions made on this page, keyed by `${domain}|${title_key}` */
	let triageUpdates = $state({});

	const findings = $derived(
		data.findings.map((f) => {
			const update = triageUpdates[`${f.triage_domain}|${f.title_key}`];
			return update ? { ...f, ...update } : f;
		})
	);

	function applyTriage({ domain, titleKey, triage }) {
		triageUpdates = { ...triageUpdates, [`${domain}|${titleKey}`]: triage };
	}

	const FILTERS = [
		{ key: 'all', label: 'ทั้งหมด', match: () => true },
		{ key: 'unreviewed', label: 'ยังไม่ตรวจ', match: (f) => !f.triage_status },
		{ key: 'review', label: '⚠ ควรตรวจซ้ำ', match: (f) => needsReviewReason(f) !== null },
		{ key: 'false_positive', label: 'False Positive', match: (f) => f.triage_status === 'false_positive' }
	];
	let filterKey = $state('all');
	const visibleFindings = $derived(findings.filter(FILTERS.find((x) => x.key === filterKey).match));
	const countFor = (key) => findings.filter(FILTERS.find((x) => x.key === key).match).length;
	const falsePositiveCount = $derived(countFor('false_positive'));

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
				{findings.length - falsePositiveCount} finding(s)
				{#if falsePositiveCount > 0}(ไม่นับ False Positive {falsePositiveCount} รายการ){/if}
				{#if findings.length > 0}— คลิกแถวเพื่อดูรายละเอียดและบันทึกผลตรวจสอบ{/if}
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
							<th>Target / URL</th>
							<th>CVSS</th>
							<th>CVE</th>
						</tr>
					</thead>
					<tbody>
						{#each visibleFindings as f (f.id)}
							{@const isOpen = expanded.has(f.id)}
							<tr
								class="finding-row"
								class:is-fp={f.triage_status === 'false_positive'}
								onclick={() => toggle(f.id)}
								aria-expanded={isOpen}
							>
								<td class="caret-cell">
									<span class="caret" class:open={isOpen}>▸</span>
								</td>
								<td><span class="sev {f.severity}">{f.severity}</span></td>
								<td class="mono">{f.identifier}</td>
								<td>{f.title}<TriageBadge finding={f} /></td>
								<td class="mono" style="max-width:220px;word-break:break-word">
									{f.affected_url_or_port ?? f.target ?? ''}
								</td>
								<td class="mono" style="font-variant-numeric:tabular-nums">
									{f.cvss_score ?? '—'}
								</td>
								<td class="mono">{f.cve ?? '—'}</td>
							</tr>
							{#if isOpen}
								<tr class="detail-row">
									<td colspan="7">
										<TriagePanel finding={f} canTriage={data.canTriage} onchange={applyTriage} />
										<FindingDetail finding={f} />
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
</style>
