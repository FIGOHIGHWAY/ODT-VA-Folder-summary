<script>
	let { data } = $props();

	let q = $state(data.q ?? '');

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
				<span style="color:var(--muted)">พบ {data.results.length} finding(s) สำหรับ "{data.q}"</span>
			</div>
			<div class="scroll">
				<table>
					<thead>
						<tr>
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
							<tr>
								<td><span class="sev {f.severity}">{f.severity}</span></td>
								<td class="mono">{f.domain ?? '—'}</td>
								<td class="mono">{f.identifier}</td>
								<td>{f.title}</td>
								<td class="mono" style="max-width:220px; word-break:break-word">
									{f.affected_url_or_port ?? f.target ?? ''}
								</td>
								<td class="mono">{f.cve ?? '—'}</td>
								<td><a class="button" href="/reports/{f.report_id}">ดู report →</a></td>
							</tr>
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
</style>
