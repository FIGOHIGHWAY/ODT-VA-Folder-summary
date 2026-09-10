<script>
	import FindingDetail from '$lib/FindingDetail.svelte';

	let { data } = $props();

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
	<title>{data.domain} · Shared Report</title>
</svelte:head>

<div class="wrap">
	<p class="eyebrow">shared report · read-only</p>
	<h1 class="mono">{data.domain}</h1>
	<p class="sub">
		ลิงก์แชร์นี้แสดงเฉพาะ finding ของ domain นี้เท่านั้น (ไม่ต้อง login)
		{#if data.roundDate}
			— เฉพาะรอบสแกนวันที่ <strong>{new Date(data.roundDate).toLocaleDateString('sv-SE')}</strong>
		{/if}
		— {data.findings.length} finding(s) จาก {data.reports.length} report(s)
	</p>

	<div class="panel">
		<h2 style="margin-bottom:.75rem">รายงานที่รวมอยู่ในลิงก์นี้</h2>
		<div class="scroll">
			<table>
				<thead>
					<tr>
						<th>Tool</th>
						<th>File</th>
						<th>Findings</th>
						<th>Imported</th>
					</tr>
				</thead>
				<tbody>
					{#each data.reports as r (r.id)}
						<tr>
							<td><span class="badge {r.source_tool}">{r.source_tool.toUpperCase()}</span></td>
							<td>{r.original_filename}</td>
							<td class="mono">{r.finding_count}</td>
							<td class="mono">{new Date(r.imported_at).toLocaleString()}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>

	<div class="panel">
		<h2 style="margin-bottom:.75rem">Findings ทั้งหมด</h2>
		{#if data.findings.length === 0}
			<div class="empty">ไม่พบ finding ใน domain นี้</div>
		{:else}
			<p class="hint">คลิกแถวเพื่อดูรายละเอียดแบบเต็ม</p>
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
						{#each data.findings as f (f.id)}
							{@const isOpen = expanded.has(f.id)}
							<tr class="finding-row" onclick={() => toggle(f.id)} aria-expanded={isOpen}>
								<td class="caret-cell">
									<span class="caret" class:open={isOpen}>▸</span>
								</td>
								<td><span class="sev {f.severity}">{f.severity}</span></td>
								<td class="mono">{f.identifier}</td>
								<td>{f.title}</td>
								<td class="mono" style="max-width:220px; word-break:break-word">
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
										<FindingDetail finding={f} showReportLink={false} />
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
	.hint {
		font-size: 0.8rem;
		color: var(--muted);
		margin: 0 0 0.5rem;
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
</style>
