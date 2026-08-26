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
	<title>{data.severity} · {data.domain} · Dashboard</title>
</svelte:head>

<div class="wrap">
	<p class="eyebrow"><a href="/dashboard">← กลับ Dashboard</a></p>
	<h1>
		<span class="sev {data.severity}">{data.severity}</span>
		<span class="mono">{data.domain}</span>
	</h1>
	<p class="sub">{data.findings.length} finding(s) — คลิกแถวเพื่อดูรายละเอียดแบบเต็ม</p>

	<div class="panel">
		{#if data.findings.length === 0}
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
						{#each data.findings as f (f.id)}
							{@const isOpen = expanded.has(f.id)}
							<tr class="finding-row" onclick={() => toggle(f.id)} aria-expanded={isOpen}>
								<td class="caret-cell">
									<span class="caret" class:open={isOpen}>▸</span>
								</td>
								<td class="mono">{f.identifier}</td>
								<td>{f.title}</td>
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
										<div class="detail-grid">
											<div class="detail-field">
												<div class="detail-label">Source tool</div>
												<div class="detail-value">
													<span class="badge {f.source_tool}">{f.source_tool.toUpperCase()}</span>
												</div>
											</div>
											<div class="detail-field">
												<div class="detail-label">File</div>
												<div class="detail-value">{f.original_filename ?? '—'}</div>
											</div>
											<div class="detail-field">
												<div class="detail-label">Imported</div>
												<div class="detail-value mono">
													{new Date(f.report_imported_at).toLocaleString()}
												</div>
											</div>
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
