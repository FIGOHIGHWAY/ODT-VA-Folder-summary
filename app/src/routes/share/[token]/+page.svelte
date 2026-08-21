<script>
	let { data } = $props();
</script>

<svelte:head>
	<title>{data.domain} · Shared Report</title>
</svelte:head>

<div class="wrap">
	<p class="eyebrow">shared report · read-only</p>
	<h1 class="mono">{data.domain}</h1>
	<p class="sub">
		ลิงก์แชร์นี้แสดงเฉพาะ finding ของ domain นี้เท่านั้น (ไม่ต้อง login) —
		{data.findings.length} finding(s) จาก {data.reports.length} report(s)
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
			<div class="scroll">
				<table>
					<thead>
						<tr>
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
							<tr>
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
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>
</div>
