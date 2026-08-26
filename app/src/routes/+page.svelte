<script>
	import { onMount } from 'svelte';
	import { lang, initLang, t } from '$lib/i18n.js';

	let { data } = $props();

	let status = $state('idle'); // idle | loading | ok | error
	let errorMessage = $state('');
	let result = $state(null);
	let dragging = $state(false);
	let fileInput;

	const VIEW_STORAGE_KEY = 'va-scan-home-view';
	let viewMode = $state('list');
	const VIEW_MODES = $derived([
		{ id: 'list', label: t($lang, 'home_view_list') },
		{ id: 'details', label: t($lang, 'home_view_details') }
	]);

	onMount(() => {
		initLang();
		const stored = localStorage.getItem(VIEW_STORAGE_KEY);
		if (stored === 'list' || stored === 'details') viewMode = stored;
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

	let folderQuery = $state('');
	const filteredDomains = $derived(
		folderQuery.trim()
			? (data.domains ?? []).filter((g) =>
					g.domain.toLowerCase().includes(folderQuery.trim().toLowerCase())
				)
			: (data.domains ?? [])
	);
	const filteredReports = $derived(
		folderQuery.trim()
			? allReports.filter((r) => r.domain.toLowerCase().includes(folderQuery.trim().toLowerCase()))
			: allReports
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
			errorMessage =
				$lang === 'th'
					? `ไฟล์มีขนาด ${mb} MB เกินลิมิตที่อัปโหลดได้ (100 MB) — ลองแบ่งไฟล์ HTML ใน ZIP เป็นหลายชุดย่อยแทน`
					: `File is ${mb} MB, over the 100 MB upload limit — try splitting the HTML files into smaller ZIP batches instead.`;
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
				errorMessage =
					$lang === 'th'
						? `เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง (HTTP ${res.status}) — ไฟล์อาจใหญ่เกินไปหรือเซิร์ฟเวอร์มีปัญหาชั่วคราว`
						: `The server sent back an invalid response (HTTP ${res.status}) — the file may be too large, or the server is temporarily having trouble.`;
				return;
			}
			if (!res.ok) {
				status = 'error';
				errorMessage = body.error ?? t($lang, 'home_parse_failed');
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
	<title>{t($lang, 'home_title')}</title>
</svelte:head>

<div class="wrap">
	<div style="display:flex; justify-content:space-between; align-items:flex-start; gap:1rem">
		<div>
			<p class="eyebrow">{t($lang, 'home_eyebrow')}</p>
			<h1>{t($lang, 'home_title')}</h1>
		</div>
		<div style="display:flex; gap:.5rem">
			<a class="button" href="/search">{t($lang, 'nav_search')}</a>
			<a class="button" href="/dashboard">{t($lang, 'nav_dashboard')}</a>
		</div>
	</div>
	<p class="sub">{t($lang, 'home_sub')}</p>

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
				<div>{t($lang, 'home_drop')}</div>
			</label>

			{#if status === 'loading'}
				<div class="status"><span class="badge">{t($lang, 'home_parsing')}</span></div>
			{:else if status === 'ok' && result?.batch}
				<div class="status">
					<span class="badge ok">
						{t($lang, 'home_batch_imported')} {result.succeeded}/{result.total} {t($lang, 'home_files_suffix')}
					</span>
					{#if result.duplicates}
						<span class="badge">
							{t($lang, 'home_duplicate_skipped')} {result.duplicates} {t($lang, 'home_files_suffix')}
						</span>
					{/if}
				</div>
				<div class="scroll">
					<table>
						<thead>
							<tr>
								<th>{t($lang, 'home_col_file')}</th>
								<th>{t($lang, 'home_col_tool')}</th>
								<th>{t($lang, 'home_col_findings')}</th>
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
									{:else if r.duplicate}
										<td colspan="2">
											<span class="badge">{t($lang, 'home_duplicate_of')} ({r.existingFilename})</span>
										</td>
										<td>
											<a class="button" href="/reports/{r.existingReportId}">{t($lang, 'home_view')}</a>
										</td>
									{:else}
										<td><span class="badge {r.type}">{r.type.toUpperCase()}</span></td>
										<td class="mono">{r.insertedCount}</td>
										<td><a class="button" href="/reports/{r.reportId}">{t($lang, 'home_view')}</a></td>
									{/if}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{:else if status === 'ok' && result?.duplicate}
				<div class="status">
					<span class="badge">{t($lang, 'home_already_imported')}</span>
					<span style="color:var(--muted)">
						{t($lang, 'home_duplicate_of_full')} {result.existingFilename} ({t($lang, 'home_imported_at')}
						{new Date(result.existingImportedAt).toLocaleString()})
					</span>
					<a class="button" href="/reports/{result.existingReportId}">{t($lang, 'home_view_original')}</a>
				</div>
			{:else if status === 'ok' && result}
				<div class="status">
					<span class="badge ok">{t($lang, 'home_saved')}</span>
					<span class="badge {result.type}">{result.type.toUpperCase()}</span>
					<span style="color:var(--muted)">
						{result.insertedCount} finding(s) · report #{result.reportId}
					</span>
					<a class="button" href="/reports/{result.reportId}">{t($lang, 'home_view_detail')}</a>
				</div>
			{:else if status === 'error'}
				<div class="status"><span class="badge err">{t($lang, 'home_parse_failed')}</span></div>
				<div class="err-box">{errorMessage}</div>
			{/if}
		</div>
	{/if}

	<div class="panel">
		<div class="panel-toolbar">
			<h2>{t($lang, 'home_reports_title')}</h2>
			<div class="view-switch" role="group" aria-label="view mode">
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
		{#if data.domains.length > 0}
			<input
				type="text"
				class="folder-search"
				bind:value={folderQuery}
				placeholder={$lang === 'th' ? '🔍 ค้นหา domain/IP...' : '🔍 Search domain/IP...'}
			/>
		{/if}
		{#if data.dbError}
			<div class="err-box">{t($lang, 'home_db_error')}: {data.dbError}</div>
		{:else if data.domains.length === 0}
			<div class="empty">{t($lang, 'home_no_reports')}</div>
		{:else if folderQuery.trim() && (viewMode === 'details' ? filteredReports.length === 0 : filteredDomains.length === 0)}
			<div class="empty">
				{$lang === 'th' ? `ไม่พบ domain/IP ที่ตรงกับ "${folderQuery}"` : `No domain/IP matching "${folderQuery}"`}
			</div>
		{:else if viewMode === 'details'}
			<div class="scroll">
				<table>
					<thead>
						<tr>
							<th>#</th>
							<th>Domain</th>
							<th>{t($lang, 'home_col_tool')}</th>
							<th>{t($lang, 'home_col_file')}</th>
							<th>{t($lang, 'home_col_findings')}</th>
							<th>{t($lang, 'home_col_imported')}</th>
							<th></th>
						</tr>
					</thead>
					<tbody>
						{#each filteredReports as r (r.id)}
							<tr>
								<td class="mono">{r.id}</td>
								<td class="mono">{r.domain}</td>
								<td><span class="badge {r.source_tool}">{r.source_tool.toUpperCase()}</span></td>
								<td>{r.original_filename}</td>
								<td class="mono">{r.finding_count}</td>
								<td class="mono">{new Date(r.imported_at).toLocaleString()}</td>
								<td>
									<a class="button" href="/reports/{r.id}">{t($lang, 'home_view')}</a>
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
							<th>{t($lang, 'home_col_name')}</th>
							<th>{t($lang, 'home_col_modified')}</th>
							<th>{t($lang, 'home_col_type')}</th>
							<th>{t($lang, 'home_col_reports')}</th>
						</tr>
					</thead>
					<tbody>
						{#each filteredDomains as group (group.domain)}
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
								<td class="muted">{t($lang, 'home_file_folder')}</td>
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

	.folder-search {
		width: 100%;
		font: inherit;
		padding: 0.5rem 0.75rem;
		margin-bottom: 0.9rem;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--panel);
		color: var(--text);
	}
	.folder-search:focus {
		outline: none;
		border-color: var(--accent);
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
