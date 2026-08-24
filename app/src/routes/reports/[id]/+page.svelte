<script>
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
	<title>Report #{data.reportId} · Scan Report Normalizer</title>
</svelte:head>

<div class="wrap">
	<p class="eyebrow"><a href="/">← กลับหน้าแรก</a></p>
	<div style="display:flex; justify-content:space-between; align-items:flex-start; gap:1rem">
		<div>
			<h1>Report #{data.reportId}</h1>
			<p class="sub">{data.findings.length} finding(s) — คลิกแถวเพื่อดูรายละเอียดแบบเต็ม</p>
		</div>
		<a class="button" href="/api/export/report/{data.reportId}">⬇️ ดึงไฟล์ (PDF)</a>
	</div>

	<div class="panel">
		{#if data.findings.length === 0}
			<div class="empty">ไม่พบ finding ใน report นี้</div>
		{:else}
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
										<div class="detail-grid">
											<div class="detail-field">
												<div class="detail-label">Source tool</div>
												<div class="detail-value">
													<span class="badge {f.source_tool}">{f.source_tool.toUpperCase()}</span>
												</div>
											</div>
											<div class="detail-field">
												<div class="detail-label">Target</div>
												<div class="detail-value mono">{f.target ?? '—'}</div>
											</div>
											<div class="detail-field">
												<div class="detail-label">Affected URL / port</div>
												<div class="detail-value mono">{f.affected_url_or_port ?? '—'}</div>
											</div>
											{#if f.confidence}
												<div class="detail-field">
													<div class="detail-label">Confidence</div>
													<div class="detail-value">{f.confidence}</div>
												</div>
											{/if}
											<div class="detail-field full">
												<div class="detail-label">Description</div>
												<div class="detail-value">{f.description || '—'}</div>
											</div>
											<div class="detail-field full">
												<div class="detail-label">Solution</div>
												<div class="detail-value">{f.solution || '—'}</div>
											</div>
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
	.detail-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 0.9rem;
	}
	.detail-field.full {
		grid-column: 1 / -1;
	}
	.detail-label {
		font-size: 0.72rem;
		color: var(--muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-bottom: 0.25rem;
	}
	.detail-value {
		font-size: 0.88rem;
		white-space: pre-wrap;
		word-break: break-word;
		line-height: 1.5;
	}
</style>
