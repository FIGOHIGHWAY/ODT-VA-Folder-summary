<script>
	let { data } = $props();

	/** group reports by the calendar date they were imported on ("รอบสแกน") — same date-grouping used for the latest-round PDF export/AI summary */
	const dateGroups = $derived.by(() => {
		/** @type {Map<string, Array<object>>} */
		const byDate = new Map();
		for (const r of data.reports) {
			const key = new Date(r.imported_at).toLocaleDateString('sv-SE'); // YYYY-MM-DD, locale-stable
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

	let sharePath = $state(data.shareLink ? `/share/${data.shareLink.token}` : null);
	let shareBusy = $state(false);
	let copied = $state(false);

	function toAbsolute(path) {
		return typeof window !== 'undefined' ? `${window.location.origin}${path}` : path;
	}

	async function shareDomain() {
		shareBusy = true;
		try {
			const res = await fetch('/api/share', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ domain: data.domain })
			});
			const body = await res.json();
			if (res.ok) sharePath = body.path;
		} finally {
			shareBusy = false;
		}
	}

	async function unshareDomain() {
		shareBusy = true;
		try {
			await fetch('/api/share', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ domain: data.domain })
			});
			sharePath = null;
		} finally {
			shareBusy = false;
		}
	}

	async function copyShareUrl() {
		await navigator.clipboard.writeText(toAbsolute(sharePath));
		copied = true;
		setTimeout(() => (copied = false), 1500);
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
			<p class="sub">{data.reports.length} report(s)</p>
		</div>
		<div class="actions">
			<a class="button" href="/api/export/domain/{data.domain}">⬇️ ดึงไฟล์ (รอบล่าสุด)</a>

			{#if data.canGenerateReport}
				{#if data.hasOwnAiKey}
					<button type="button" class="button" disabled={aiBusy} onclick={summarize}>
						{aiBusy ? '🤖 กำลังสรุป...' : aiSummary ? '🤖 สรุปใหม่' : '🤖 สรุปด้วย AI'}
					</button>
				{:else}
					<a class="button" href="/ai-key">🔌 เชื่อมต่อ AI ของฉันเพื่อสรุป</a>
				{/if}
			{/if}

			{#if sharePath}
				<button type="button" class="button" disabled={shareBusy} onclick={copyShareUrl}>
					{copied ? '✅ คัดลอกแล้ว' : '🔗 คัดลอกลิงก์'}
				</button>
				<button type="button" class="button" disabled={shareBusy} onclick={unshareDomain}>
					ยกเลิกแชร์
				</button>
			{:else}
				<button type="button" class="button" disabled={shareBusy} onclick={shareDomain}>
					🔗 แชร์
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
											<a class="button" href="/reports/{r.id}">ดู →</a>
											<a class="button" href="/api/export/report/{r.id}">⬇️</a>
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
	.date-folder-head {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		width: 100%;
		background: none;
		border: none;
		cursor: pointer;
		font: inherit;
		color: var(--text);
		text-align: left;
		padding: 0;
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
