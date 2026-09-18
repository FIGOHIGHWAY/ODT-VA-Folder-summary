<script>
	import { goto } from '$app/navigation';

	let { data } = $props();

	/** local mutable copy so a delete can remove a row instantly without a full reload */
	let reports = $state(data.reports);
	$effect(() => {
		reports = data.reports;
	});

	let deleteBusy = $state(new Set());

	async function deleteReport(reportId, filename) {
		if (!confirm(`ลบ report "${filename}" ทิ้งถาวร? ข้อมูล finding และไฟล์ต้นฉบับ (ถ้ามี) จะหายไปเลย กู้คืนไม่ได้`)) {
			return;
		}
		deleteBusy = new Set(deleteBusy).add(reportId);
		try {
			const res = await fetch(`/api/reports/${reportId}`, { method: 'DELETE' });
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				alert(body.error ?? 'ลบไม่สำเร็จ');
				return;
			}
			const remaining = reports.filter((r) => r.id !== reportId);
			if (remaining.length === 0) {
				goto('/');
				return;
			}
			reports = remaining;
		} finally {
			const next = new Set(deleteBusy);
			next.delete(reportId);
			deleteBusy = next;
		}
	}

	/**
	 * Group reports by their effective scan date ("รอบสแกน") — scanned_at
	 * when we could recover a real scan date from the filename, else
	 * imported_at. Same effective-date logic used for the latest-round PDF
	 * export/AI summary/dashboard, so a report uploaded long after it was
	 * actually scanned still lands in its correct historical round instead
	 * of getting lumped in with whatever else was uploaded that day.
	 */
	const dateGroups = $derived.by(() => {
		/** @type {Map<string, Array<object>>} */
		const byDate = new Map();
		for (const r of reports) {
			const effective = r.scanned_at ?? r.imported_at;
			const key = new Date(effective).toLocaleDateString('sv-SE'); // YYYY-MM-DD, locale-stable
			if (!byDate.has(key)) byDate.set(key, []);
			byDate.get(key).push(r);
		}
		return [...byDate.entries()]
			.map(([date, reports]) => ({ date, reports }))
			.sort((a, b) => (a.date < b.date ? 1 : -1));
	});

	/** @type {Set<string>} dates collapsed by the user — the latest round starts open, the rest start closed */
	let collapsedDates = $state(new Set());
	let collapsedInit = false;
	$effect(() => {
		if (!collapsedInit && dateGroups.length > 0) {
			collapsedInit = true;
			collapsedDates = new Set(dateGroups.slice(1).map((g) => g.date));
		}
	});

	function toggleDate(date) {
		const next = new Set(collapsedDates);
		if (next.has(date)) next.delete(date);
		else next.add(date);
		collapsedDates = next;
	}

/** key used in the sharePaths/shareBusy maps for the "all rounds" link (round_date IS NULL) */
	const ALL_ROUNDS_KEY = '__all__';

	/** @type {Record<string, string>} round key ('YYYY-MM-DD' or ALL_ROUNDS_KEY) -> "/share/<token>" */
	let sharePaths = $state(
		Object.fromEntries(
			(data.shareLinks ?? []).map((link) => [
				link.round_date ?? ALL_ROUNDS_KEY,
				`/share/${link.token}`
			])
		)
	);
	let shareBusy = $state(new Set());
	let copiedRound = $state(null);

	function toAbsolute(path) {
		return typeof window !== 'undefined' ? `${window.location.origin}${path}` : path;
	}

	async function shareRound(roundDate) {
		const key = roundDate ?? ALL_ROUNDS_KEY;
		shareBusy = new Set(shareBusy).add(key);
		try {
			const res = await fetch('/api/share', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ domain: data.domain, roundDate })
			});
			const body = await res.json();
			if (res.ok) sharePaths = { ...sharePaths, [key]: body.path };
		} finally {
			const next = new Set(shareBusy);
			next.delete(key);
			shareBusy = next;
		}
	}

	async function unshareRound(roundDate) {
		const key = roundDate ?? ALL_ROUNDS_KEY;
		shareBusy = new Set(shareBusy).add(key);
		try {
			await fetch('/api/share', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ domain: data.domain, roundDate })
			});
			const next = { ...sharePaths };
			delete next[key];
			sharePaths = next;
		} finally {
			const next = new Set(shareBusy);
			next.delete(key);
			shareBusy = next;
		}
	}

	async function copyShareUrl(roundDate) {
		const key = roundDate ?? ALL_ROUNDS_KEY;
		await navigator.clipboard.writeText(toAbsolute(sharePaths[key]));
		copiedRound = key;
		setTimeout(() => {
			if (copiedRound === key) copiedRound = null;
		}, 1500);
	}

	/** @type {{ summary: string, model: string }|null} */
	let aiSummary = $state(
		data.aiSummary ? { summary: data.aiSummary.summary, model: data.aiSummary.model } : null
	);
	let aiBusy = $state(false);
	let aiError = $state('');

	async function summarize() {
		aiBusy = true;
		aiError = '';
		try {
			const res = await fetch('/api/summarize', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ domain: data.domain })
			});
			const body = await res.json();
			if (!res.ok) {
				aiError = body.error ?? body.message ?? 'สรุปไม่สำเร็จ';
				return;
			}
			aiSummary = { summary: body.summary, model: body.model };
		} catch (err) {
			aiError = err instanceof Error ? err.message : String(err);
		} finally {
			aiBusy = false;
		}
	}
</script>

<svelte:head>
	<title>{data.domain} · Scan Report Normalizer</title>
</svelte:head>

<div class="wrap">
	<p class="eyebrow"><a href="/">← กลับหน้าแรก</a></p>
	<div class="head-row">
		<div>
			<h1><span class="folder-icon">📁</span> {data.domain}</h1>
			<p class="sub">{reports.length} report(s)</p>
		</div>
		<div class="actions">
			<a class="button" href="/api/export/domain/{data.domain}">⬇️ ดึงไฟล์ (รอบล่าสุด)</a>

			{#if data.user?.role === 'admin'}
				<a class="button" href="/links">🔗 จัดการลิงก์ทั้งหมด</a>
			{/if}

			{#if data.canGenerateReport}
				{#if data.hasOwnAiKey}
					<button type="button" class="button" disabled={aiBusy} onclick={summarize}>
						{aiBusy ? '🤖 กำลังสรุป...' : aiSummary ? '🤖 สรุปใหม่' : '🤖 สรุปด้วย AI'}
					</button>
				{:else}
					<a class="button" href="/ai-key">🔌 เชื่อมต่อ AI ของฉันเพื่อสรุป</a>
				{/if}
			{/if}

			{#if sharePaths[ALL_ROUNDS_KEY]}
				<button
					type="button"
					class="button"
					disabled={shareBusy.has(ALL_ROUNDS_KEY)}
					onclick={() => copyShareUrl(null)}
				>
					{copiedRound === ALL_ROUNDS_KEY ? '✅ คัดลอกแล้ว' : '🔗 คัดลอกลิงก์ (ทุกรอบ)'}
				</button>
				<button
					type="button"
					class="button"
					disabled={shareBusy.has(ALL_ROUNDS_KEY)}
					onclick={() => unshareRound(null)}
				>
					ยกเลิกแชร์ทุกรอบ
				</button>
			{:else}
				<button
					type="button"
					class="button"
					disabled={shareBusy.has(ALL_ROUNDS_KEY)}
					onclick={() => shareRound(null)}
				>
					🔗 แชร์ทุกรอบ
				</button>
			{/if}
		</div>
	</div>

	{#if aiError}
		<div class="err-box">{aiError}</div>
	{/if}
	{#if aiSummary}
		<div class="panel ai-summary">
			<div class="ai-summary-label">🤖 สรุปโดย {aiSummary.model}</div>
			<pre>{aiSummary.summary}</pre>
		</div>
	{/if}

	<div class="date-folders">
		{#each dateGroups as group, i (group.date)}
			{@const isOpen = !collapsedDates.has(group.date)}
			{@const findingTotal = group.reports.reduce((sum, r) => sum + r.finding_count, 0)}
			<div class="panel date-folder">
				<div class="date-folder-head-row">
					<button
						type="button"
						class="date-folder-head"
						onclick={() => toggleDate(group.date)}
						aria-expanded={isOpen}
					>
						<span class="caret" class:open={isOpen}>▸</span>
						<span class="folder-icon">📁</span>
						<span class="date-label mono">{group.date}</span>
						{#if i === 0}
							<span class="badge ok">รอบล่าสุด</span>
						{/if}
						<span class="date-meta">
							{group.reports.length} report(s) · {findingTotal} finding(s)
						</span>
					</button>
					<div class="round-share-actions">
						{#if sharePaths[group.date]}
							<button
								type="button"
								class="button share-btn"
								disabled={shareBusy.has(group.date)}
								onclick={() => copyShareUrl(group.date)}
							>
								{copiedRound === group.date ? '✅ คัดลอกแล้ว' : '🔗 คัดลอกลิงก์'}
							</button>
							<button
								type="button"
								class="button share-btn"
								disabled={shareBusy.has(group.date)}
								onclick={() => unshareRound(group.date)}
							>
								ยกเลิกแชร์
							</button>
						{:else}
							<button
								type="button"
								class="button share-btn"
								disabled={shareBusy.has(group.date)}
								onclick={() => shareRound(group.date)}
							>
								🔗 แชร์รอบนี้
							</button>
						{/if}
					</div>
				</div>

				{#if isOpen}
					<div class="scroll" style="margin-top:0.75rem">
						<table>
							<thead>
								<tr>
									<th>#</th>
									<th>Tool</th>
									<th>File</th>
									<th>Findings</th>
									<th>Imported</th>
									<th></th>
								</tr>
							</thead>
							<tbody>
								{#each group.reports as r (r.id)}
									<tr>
										<td class="mono">{r.id}</td>
										<td><span class="badge {r.source_tool}">{r.source_tool.toUpperCase()}</span></td>
										<td>{r.original_filename}</td>
										<td class="mono">{r.finding_count}</td>
										<td class="mono">{new Date(r.imported_at).toLocaleString()}</td>
										<td>
											<div class="row-actions">
												<a class="icon-action" href="/reports/{r.id}" title="ดูรายละเอียด">🔍</a>
												<a
													class="icon-action"
													href="/api/export/report/{r.id}"
													title="ดึงไฟล์ PDF"
												>
													📄
												</a>
												{#if r.has_original}
													<span class="action-sep"></span>
													<a
														class="icon-action"
														href="/api/reports/{r.id}/preview"
														target="_blank"
														rel="noopener"
														title="ดูตัวอย่างไฟล์ต้นฉบับ"
													>
														👁️
													</a>
													<a
														class="icon-action"
														href="/api/reports/{r.id}/original"
														title="ดาวน์โหลดไฟล์ต้นฉบับ"
													>
														💾
													</a>
												{/if}
												{#if data.canDelete}
													<span class="action-sep"></span>
													<button
														type="button"
														class="icon-action icon-danger"
														disabled={deleteBusy.has(r.id)}
														onclick={() => deleteReport(r.id, r.original_filename)}
														title="ลบ report นี้ทิ้งถาวร"
													>
														🗑️
													</button>
												{/if}
											</div>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</div>
		{/each}
	</div>
</div>

<style>
	.row-actions {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		white-space: nowrap;
	}
	.icon-action {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.8rem;
		height: 1.8rem;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--panel);
		text-decoration: none;
		font-size: 0.85rem;
		line-height: 1;
		flex: 0 0 auto;
	}
	.icon-action:hover {
		border-color: var(--accent);
		background: var(--code-bg);
	}
	.icon-action.icon-danger {
		cursor: pointer;
		font: inherit;
	}
	.icon-action.icon-danger:hover:not(:disabled) {
		border-color: var(--err);
		background: rgba(220, 38, 38, 0.08);
	}
	.icon-action.icon-danger:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.action-sep {
		width: 1px;
		align-self: stretch;
		background: var(--border);
		margin: 0 0.15rem;
	}

	.head-row {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
		flex-wrap: wrap;
		margin-bottom: 1rem;
	}
	.folder-icon {
		font-size: 1.1em;
	}
	.actions {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.ai-summary {
		padding: 0.9rem 1rem;
	}
	.ai-summary-label {
		font-size: 0.72rem;
		color: var(--muted);
		margin-bottom: 0.4rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.ai-summary pre {
		margin: 0;
		white-space: pre-wrap;
		word-break: break-word;
		font-family: inherit;
		font-size: 0.85rem;
		line-height: 1.6;
	}

	.date-folders {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.date-folder {
		margin-bottom: 0;
	}
	.date-folder-head-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}
	.date-folder-head {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		flex: 1;
		min-width: 0;
		background: none;
		border: none;
		cursor: pointer;
		font: inherit;
		color: var(--text);
		text-align: left;
		padding: 0;
	}
	.round-share-actions {
		display: flex;
		gap: 0.4rem;
		flex: 0 0 auto;
	}
	.round-share-actions .share-btn {
		font-size: 0.75rem;
		padding: 0.3rem 0.6rem;
		white-space: nowrap;
	}
	.date-folder-head:hover {
		color: var(--accent);
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
	.date-label {
		font-weight: 700;
		font-size: 0.95rem;
	}
	.date-meta {
		margin-left: auto;
		color: var(--muted);
		font-size: 0.8rem;
	}
</style>
