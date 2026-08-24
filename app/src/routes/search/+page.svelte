<script>
	let { data } = $props();

	let q = $state(data.q ?? '');

	/** @type {Set<number>} finding ids currently expanded to show full detail */
	let expanded = $state(new Set());

	function toggle(id) {
		const next = new Set(expanded);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		expanded = next;
	}

	function onSubmit(e) {
		e.preventDefault();
		const url = new URL(window.location.href);
		url.searchParams.set('q', q);
		window.location.href = url.toString();
	}
</script>

<svelte:head>
	<title>ค้นหา · Scan Report Normalizer</title>
</svelte:head>

<div class="wrap">
	<p class="eyebrow"><a href="/">← กลับหน้าแรก</a></p>
	<h1>ค้นหา Findings</h1>
	<p class="sub">
		ค้นหาจาก title, identifier, description, solution, CVE, target/URL และ domain ของ report —
		ค้นได้ทุก report ที่นำเข้าไว้
	</p>

	<div class="panel">
		<form onsubmit={onSubmit} style="display:flex; gap:.5rem">
			<input
				type="text"
				bind:value={q}
				placeholder="เช่น CVE-2020-12345, XSS, nginx, pd-learning.md.kku.ac.th ..."
				class="search-input mono"
			/>
			<button type="submit" class="button primary">ค้นหา</button>
		</form>
	</div>

	<div class="panel">
		{#if data.dbError}
			<div class="err-box">เชื่อมต่อฐานข้อมูลไม่สำเร็จ: {data.dbError}</div>
		{:else if !data.q.trim()}
			<div class="empty">พิมพ์คำค้นหาด้านบนเพื่อเริ่มค้นหา</div>
		{:else if data.results.length === 0}
			<div class="empty">ไม่พบผลลัพธ์สำหรับ "{data.q}"</div>
		{:else}
			<div class="status">
				<span style="color:var(--muted)">
					พบ {data.results.length} finding(s) สำหรับ "{data.q}" — คลิกแถวเพื่อดูรายละเอียดแบบเต็ม
				</span>
			</div>
			<div class="scroll">
				<table>
					<thead>
						<tr>
							<th></th>
							<th>Severity</th>
							<th>Domain</th>
							<th>Identifier</th>
							<th>Title</th>
							<th>Target / URL</th>
							<th>CVE</th>
							<th></th>
						</tr>
					</thead>
					<tbody>
						{#each data.results as f (f.id)}
							{@const isOpen = expanded.has(f.id)}
							<tr class="finding-row" onclick={() => toggle(f.id)} aria-expanded={isOpen}>
								<td class="caret-cell">
									<span class="caret" class:open={isOpen}>▸</span>
								</td>
								<td><span class="sev {f.severity}">{f.severity}</span></td>
								<td class="mono">{f.domain ?? '—'}</td>
								<td class="mono">{f.identifier}</td>
								<td>{f.title}</td>
								<td class="mono" style="max-width:220px; word-break:break-word">
									{f.affected_url_or_port ?? f.target ?? ''}
								</td>
								<td class="mono">{f.cve ?? '—'}</td>
								<td>
									<a
										class="button"
										href="/reports/{f.report_id}"
										onclick={(e) => e.stopPropagation()}
									>
										ดู report →
									</a>
								</td>
							</tr>
							{#if isOpen}
								<tr class="detail-row">
									<td colspan="8">
										<div class="detail-grid">
											<div class="detail-field">
												<div class="detail-label">Source tool</div>
												<div class="detail-value">
													<span class="badge {f.source_tool}">{f.source_tool.toUpperCase()}</span>
												</div>
											</div>
											<div class="detail-field">
												<div class="detail-label">CVSS</div>
												<div class="detail-value mono">{f.cvss_score ?? '—'}</div>
											</div>
											<div class="detail-field">
												<div class="detail-label">File</div>
												<div class="detail-value">{f.original_filename ?? '—'}</div>
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
	.search-input {
		flex: 1;
		font: inherit;
		padding: 0.55rem 0.8rem;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--panel);
		color: var(--text);
	}

	.search-input:focus {
		outline: none;
		border-color: var(--accent);
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
