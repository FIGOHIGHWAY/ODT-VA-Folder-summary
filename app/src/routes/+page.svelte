<script>
	import { onMount } from 'svelte';

	let { data } = $props();

	let status = $state('idle'); // idle | loading | ok | error
	let errorMessage = $state('');
	let result = $state(null);
	let dragging = $state(false);
	let fileInput;

	const VIEW_MODES = [
		{ id: 'list', label: '📋 รายการ' },
		{ id: 'details', label: '📊 รายละเอียด' }
	];
	const VIEW_STORAGE_KEY = 'va-scan-home-view';
	let viewMode = $state('list');

	onMount(() => {
		const stored = localStorage.getItem(VIEW_STORAGE_KEY);
		if (stored && VIEW_MODES.some((v) => v.id === stored)) viewMode = stored;
	});

	function setViewMode(mode) {
		viewMode = mode;
		if (typeof localStorage !== 'undefined') localStorage.setItem(VIEW_STORAGE_KEY, mode);
	}

	/** flattened, most-recent-first list of every report across every domain, for the "details" view */
	const allReports = $derived(
		(data.domains ?? [])
			.flatMap((g) => g.reports.map((r) => ({ ...r, domain: g.domain })))
			.sort((a, b) => new Date(b.imported_at) - new Date(a.imported_at))
	);

	// Must match nginx's client_max_body_size — checked client-side so an
	// oversized file gets a clear Thai message instead of nginx's raw HTML
	// error page failing to parse as JSON.
	const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

	async function submitFile(file) {
		status = 'loading';
		errorMessage = '';
		result = null;

		if (file.size > MAX_UPLOAD_BYTES) {
			status = 'error';
			const mb = (file.size / (1024 * 1024)).toFixed(1);
			errorMessage = `ไฟล์มีขนาด ${mb} MB เกินลิมิตที่อัปโหลดได้ (100 MB) — ลองแบ่งไฟล์ HTML ใน ZIP เป็นหลายชุดย่อยแทน`;
			return;
		}

		const form = new FormData();
		form.append('file', file);

		try {
			const res = await fetch('/api/parse', { method: 'POST', body: form });
			let body;
			try {
				body = await res.json();
			} catch {
				status = 'error';
				errorMessage = `เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง (HTTP ${res.status}) — ไฟล์อาจใหญ่เกินไปหรือเซิร์ฟเวอร์มีปัญหาชั่วคราว`;
				return;
			}
			if (!res.ok) {
				status = 'error';
				errorMessage = body.error ?? 'parse failed';
				return;
			}
			status = 'ok';
			result = body;
		} catch (err) {
			status = 'error';
			errorMessage = err instanceof Error ? err.message : String(err);
		}
	}

	function onFileChange(e) {
		const file = e.target.files?.[0];
		if (file) submitFile(file);
	}

	function onDrop(e) {
		e.preventDefault();
		dragging = false;
		const file = e.dataTransfer.files?.[0];
		if (file) submitFile(file);
	}
</script>

<svelte:head>
	<title>Scan Report Normalizer</title>
</svelte:head>

<div class="wrap">
	<div style="display:flex; justify-content:space-between; align-items:flex-start; gap:1rem">
		<div>
			<p class="eyebrow">nessus · zap → unified json → postgres</p>
			<h1>Scan Report Normalizer</h1>
		</div>
		<div style="display:flex; gap:.5rem">
			<a class="button" href="/search">🔍 ค้นหา</a>
			<a class="button" href="/dashboard">📊 Dashboard</a>
		</div>
	</div>
	<p class="sub">
		อัปโหลดไฟล์ HTML export จาก Nessus หรือ OWASP ZAP ระบบจะ detect ประเภท, parse เป็น JSON
		schema เดียวกัน แล้วบันทึกลง PostgreSQL อัตโนมัติ
	</p>

	{#if data.canUpload}
		<div class="panel">
			<label
				class="drop"
				class:drag={dragging}
				ondragover={(e) => {
					e.preventDefault();
					dragging = true;
				}}
				ondragleave={() => (dragging = false)}
				ondrop={onDrop}
			>
				<input
					bind:this={fileInput}
					type="file"
					accept=".html,.htm,.zip"
					onchange={onFileChange}
					style="display:none"
				/>
				<div>📄 คลิกหรือลากไฟล์ HTML export (หรือ ZIP รวมหลายไฟล์) มาวางที่นี่</div>
			</label>

			{#if status === 'loading'}
				<div class="status"><span class="badge">กำลัง parse...</span></div>
			{:else if status === 'ok' && result?.batch}
				<div class="status">
					<span class="badge ok">นำเข้าจาก ZIP สำเร็จ {result.succeeded}/{result.total} ไฟล์</span>
				</div>
				<div class="scroll">
					<table>
						<thead>
							<tr>
								<th>File</th>
								<th>Tool</th>
								<th>Findings</th>
								<th></th>
							</tr>
						</thead>
						<tbody>
							{#each result.results as r (r.filename)}
								<tr>
									<td>{r.filename}</td>
									{#if r.error}
										<td colspan="2"><span class="badge err">{r.error}</span></td>
										<td></td>
									{:else}
										<td><span class="badge {r.type}">{r.type.toUpperCase()}</span></td>
										<td class="mono">{r.insertedCount}</td>
										<td><a class="button" href="/reports/{r.reportId}">ดู →</a></td>
									{/if}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{:else if status === 'ok' && result}
				<div class="status">
					<span class="badge ok">บันทึกสำเร็จ</span>
					<span class="badge {result.type}">{result.type.toUpperCase()}</span>
					<span style="color:var(--muted)">
						{result.insertedCount} finding(s) · report #{result.reportId}
					</span>
					<a class="button" href="/reports/{result.reportId}">ดูรายละเอียด →</a>
				</div>
			{:else if status === 'error'}
				<div class="status"><span class="badge err">Parse failed</span></div>
				<div class="err-box">{errorMessage}</div>
			{/if}
		</div>
	{/if}

	<div class="panel">
		<div class="panel-toolbar">
			<h2>รายงานที่เคยนำเข้า (จัดกลุ่มตาม domain)</h2>
			<div class="view-switch" role="group" aria-label="รูปแบบการแสดงผล">
				{#each VIEW_MODES as v (v.id)}
					<button
						type="button"
						class="view-switch-btn"
						class:active={viewMode === v.id}
						onclick={() => setViewMode(v.id)}
					>
						{v.label}
					</button>
				{/each}
			</div>
		</div>
		{#if data.dbError}
			<div class="err-box">เชื่อมต่อฐานข้อมูลไม่สำเร็จ: {data.dbError}</div>
		{:else if data.domains.length === 0}
			<div class="empty">ยังไม่มีรายงานที่นำเข้า</div>
		{:else if viewMode === 'details'}
			<div class="scroll">
				<table>
					<thead>
						<tr>
							<th>#</th>
							<th>Domain</th>
							<th>Tool</th>
							<th>File</th>
							<th>Findings</th>
							<th>Imported</th>
							<th></th>
						</tr>
					</thead>
					<tbody>
						{#each allReports as r (r.id)}
							<tr>
								<td class="mono">{r.id}</td>
								<td class="mono">{r.domain}</td>
								<td><span class="badge {r.source_tool}">{r.source_tool.toUpperCase()}</span></td>
								<td>{r.original_filename}</td>
								<td class="mono">{r.finding_count}</td>
								<td class="mono">{new Date(r.imported_at).toLocaleString()}</td>
								<td>
									<a class="button" href="/reports/{r.id}">ดู →</a>
									<a class="button" href="/api/export/report/{r.id}">⬇️</a>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<div class="scroll">
				<table class="explorer-table">
					<thead>
						<tr>
							<th></th>
							<th>Name</th>
							<th>Date modified</th>
							<th>Type</th>
							<th>Reports</th>
						</tr>
					</thead>
					<tbody>
						{#each data.domains as group (group.domain)}
							{@const href = group.domain === 'unknown' ? null : `/folder/${group.domain}`}
							{@const latest = group.reports[0]?.imported_at}
							<tr class="explorer-row" class:disabled={!href}>
								<td class="explorer-icon">📁</td>
								<td class="explorer-name">
									{#if href}
										<a href={href}>{group.domain}</a>
									{:else}
										{group.domain}
									{/if}
								</td>
								<td class="mono">{latest ? new Date(latest).toLocaleString() : '—'}</td>
								<td class="muted">File folder</td>
								<td class="mono">{group.reports.length}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>
</div>

<style>
	.drop {
		border: 2px dashed var(--border);
		border-radius: 10px;
		padding: 2rem;
		text-align: center;
		cursor: pointer;
		transition: 0.15s;
		color: var(--muted);
		display: block;
	}
	.drop:hover,
	.drop.drag {
		border-color: var(--accent);
		color: var(--accent);
		background: rgba(37, 99, 235, 0.05);
	}

	.panel-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 0.75rem;
		flex-wrap: wrap;
	}
	.panel-toolbar h2 {
		margin: 0;
	}

	.view-switch {
		display: flex;
		border: 1px solid var(--border);
		border-radius: 8px;
		overflow: hidden;
	}
	.view-switch-btn {
		background: none;
		border: none;
		border-right: 1px solid var(--border);
		padding: 0.4rem 0.7rem;
		font-size: 0.78rem;
		cursor: pointer;
		color: var(--muted);
		white-space: nowrap;
	}
	.view-switch-btn:last-child {
		border-right: none;
	}
	.view-switch-btn.active {
		background: var(--code-bg);
		color: var(--accent);
		font-weight: 600;
	}
	.view-switch-btn:hover {
		color: var(--accent);
	}

	.explorer-table {
		width: 100%;
	}
	.explorer-row:hover {
		background: var(--code-bg);
	}
	.explorer-row.disabled {
		opacity: 0.6;
	}
	.explorer-icon {
		font-size: 1.2rem;
		width: 1.5rem;
	}
	.explorer-name a {
		color: var(--text);
		text-decoration: none;
		font-weight: 600;
	}
	.explorer-name a:hover {
		color: var(--accent);
		text-decoration: underline;
	}
	.muted {
		color: var(--muted);
	}
</style>
