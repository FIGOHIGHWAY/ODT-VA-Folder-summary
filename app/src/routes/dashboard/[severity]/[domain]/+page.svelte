<script>
	import FindingDetail from '$lib/FindingDetail.svelte';
	import TriageBadge from '$lib/TriageBadge.svelte';
	import TriagePanel from '$lib/TriagePanel.svelte';

	let { data } = $props();

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

	/** @type {Set<number>} finding ids currently expanded to show full detail */
	let expanded = $state(new Set());

	function toggle(id) {
		const next = new Set(expanded);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		expanded = next;
	}
</script>

<svelte:head>
	<title>{data.severity} · {data.domain} · Dashboard</title>
</svelte:head>

<div class="wrap">
	<p class="eyebrow"><a href="/dashboard">← กลับ Dashboard</a></p>
	<h1>
		<span class="sev {data.severity}">{data.severity}</span>
		<span class="mono">{data.domain}</span>
	</h1>
	<p class="sub">{findings.length} finding(s) (ไม่นับ False Positive) — คลิกแถวเพื่อดูรายละเอียดและบันทึกผลตรวจสอบ</p>

	<div class="panel">
		{#if findings.length === 0}
			<div class="empty">ไม่พบ finding</div>
		{:else}
			<div class="scroll">
				<table>
					<thead>
						<tr>
							<th></th>
							<th>Identifier</th>
							<th>Title</th>
							<th>Target / URL</th>
							<th>CVSS</th>
							<th>CVE</th>
							<th>Report</th>
						</tr>
					</thead>
					<tbody>
						{#each findings as f (f.id)}
							{@const isOpen = expanded.has(f.id)}
							<tr class="finding-row" class:is-fp={f.triage_status === 'false_positive'} onclick={() => toggle(f.id)} aria-expanded={isOpen}>
								<td class="caret-cell">
									<span class="caret" class:open={isOpen}>▸</span>
								</td>
								<td class="mono">{f.identifier}</td>
								<td>{f.title}<TriageBadge finding={f} /></td>
								<td class="mono" style="max-width:220px;word-break:break-word">
									{f.affected_url_or_port ?? f.target ?? ''}
								</td>
								<td class="mono" style="font-variant-numeric:tabular-nums">
									{f.cvss_score ?? '—'}
								</td>
								<td class="mono">{f.cve ?? '—'}</td>
								<td>
									<a
										class="button"
										href="/reports/{f.report_id}"
										onclick={(e) => e.stopPropagation()}
									>
										#{f.report_id} →
									</a>
								</td>
							</tr>
							{#if isOpen}
								<tr class="detail-row">
									<td colspan="7">
										<TriagePanel finding={f} canTriage={data.canTriage} onchange={applyTriage} />
										<FindingDetail finding={f} />
										<div class="extra-meta">
											<span class="detail-label">File</span>
											<span class="mono">{f.original_filename ?? '—'}</span>
											<span class="detail-label">Imported</span>
											<span class="mono">{new Date(f.report_imported_at).toLocaleString()}</span>
										</div>
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
	.finding-row.is-fp td {
		opacity: 0.5;
	}
	h1 {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}

	.finding-row {
		cursor: pointer;
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
	.extra-meta {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		flex-wrap: wrap;
		margin-top: 0.75rem;
		font-size: 0.8rem;
	}
	.extra-meta .detail-label {
		font-size: 0.72rem;
		color: var(--muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
</style>
