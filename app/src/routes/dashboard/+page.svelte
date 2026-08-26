<script>
	let { data } = $props();

	const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'];
	const SEVERITY_LABEL = {
		critical: 'Critical',
		high: 'High',
		medium: 'Medium',
		low: 'Low',
		info: 'Info'
	};

	let showSeverityTable = $state(false);
	let showYearlyTable = $state(false);

	/** @type {string|null} severity currently expanded to show its domain breakdown */
	let openSeverity = $state(null);
	let breakdownLoading = $state(false);
	/** @type {Array<{domain: string, count: number}>} */
	let breakdown = $state([]);

	async function toggleSeverity(severity) {
		if (openSeverity === severity) {
			openSeverity = null;
			return;
		}
		openSeverity = severity;
		breakdownLoading = true;
		breakdown = [];
		try {
			const res = await fetch(`/api/dashboard/severity/${severity}`);
			const body = await res.json();
			breakdown = body.domains ?? [];
		} finally {
			breakdownLoading = false;
		}
	}

	/** @type {{ x: number, y: number, text: string } | null} */
	let tooltip = $state(null);

	function showTooltip(e, text) {
		const rect = e.currentTarget.closest('.chart-plot').getBoundingClientRect();
		tooltip = { x: e.clientX - rect.left, y: e.clientY - rect.top, text };
	}

	function hideTooltip() {
		tooltip = null;
	}

	const maxSeverityCount = $derived(
		data.summary ? Math.max(1, ...data.summary.bySeverity.map((s) => s.count)) : 1
	);

	const maxYearTotal = $derived(Math.max(1, ...data.yearly.map((y) => y.total)));
</script>

<svelte:head>
	<title>Dashboard · Scan Report Normalizer</title>
</svelte:head>

<div class="wrap">
	<p class="eyebrow"><a href="/">← กลับหน้าแรก</a></p>
	<h1>Dashboard</h1>
	<p class="sub">สรุปภาพรวม finding ทั้งหมดที่นำเข้า และแนวโน้มแยกตามปี</p>

	{#if data.dbError}
		<div class="panel">
			<div class="err-box">เชื่อมต่อฐานข้อมูลไม่สำเร็จ: {data.dbError}</div>
		</div>
	{:else}
		<div class="stat-row">
			<div class="stat-tile">
				<div class="stat-value mono">{data.summary.totalReports}</div>
				<div class="stat-label">Reports นำเข้าแล้ว</div>
			</div>
			<div class="stat-tile">
				<div class="stat-value mono">{data.summary.totalFindings}</div>
				<div class="stat-label">Findings ทั้งหมด</div>
			</div>
			<div class="stat-tile">
				<div class="stat-value mono">{data.summary.totalDomains}</div>
				<div class="stat-label">Domain ที่ถูกสแกน</div>
			</div>
			<div class="stat-tile">
				<div class="stat-value mono">{data.summary.yearsCovered.length}</div>
				<div class="stat-label">
					ปีที่มีข้อมูล
					{#if data.summary.yearsCovered.length > 0}
						<span class="stat-sub">({data.summary.yearsCovered.join(', ')})</span>
					{/if}
				</div>
			</div>
		</div>

		<div class="panel">
			<div class="chart-head">
				<h2>Findings แยกตาม Severity (รวมทุกปี)</h2>
				<button class="button" onclick={() => (showSeverityTable = !showSeverityTable)}>
					{showSeverityTable ? 'ซ่อนตาราง' : 'ดูตาราง'}
				</button>
			</div>

			{#if data.summary.totalFindings === 0}
				<div class="empty">ยังไม่มี finding ในระบบ</div>
			{:else}
				<div class="hbar-chart">
					{#each data.summary.bySeverity as s (s.severity)}
						<button
							type="button"
							class="hbar-row hbar-row-btn"
							class:active={openSeverity === s.severity}
							onclick={() => toggleSeverity(s.severity)}
							disabled={s.count === 0}
						>
							<span class="hbar-label sev {s.severity}">{SEVERITY_LABEL[s.severity]}</span>
							<div class="hbar-track">
								<div
									class="hbar-fill sev-fill-{s.severity}"
									style="width:{(s.count / maxSeverityCount) * 100}%"
								></div>
							</div>
							<span class="hbar-value mono">{s.count}</span>
						</button>
						{#if openSeverity === s.severity}
							<div class="breakdown-panel">
								{#if breakdownLoading}
									<div class="empty">กำลังโหลด...</div>
								{:else if breakdown.length === 0}
									<div class="empty">ไม่พบ domain</div>
								{:else}
									<div class="breakdown-hint">
										{SEVERITY_LABEL[s.severity]} มาจาก domain เหล่านี้ — คลิกเพื่อดูรายการ finding
									</div>
									<div class="breakdown-list">
										{#each breakdown as d (d.domain)}
											<a
												class="breakdown-item"
												href="/dashboard/{s.severity}/{d.domain}"
											>
												<span class="mono">{d.domain}</span>
												<span class="breakdown-count mono">{d.count}</span>
											</a>
										{/each}
									</div>
								{/if}
							</div>
						{/if}
					{/each}
				</div>

				{#if showSeverityTable}
					<div class="scroll" style="margin-top:1rem">
						<table>
							<thead>
								<tr>
									<th>Severity</th>
									<th>Count</th>
									<th>%</th>
								</tr>
							</thead>
							<tbody>
								{#each data.summary.bySeverity as s (s.severity)}
									<tr>
										<td><span class="sev {s.severity}">{s.severity}</span></td>
										<td class="mono">{s.count}</td>
										<td class="mono">
											{data.summary.totalFindings > 0
												? ((s.count / data.summary.totalFindings) * 100).toFixed(1)
												: '0.0'}%
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			{/if}
		</div>

		<div class="panel">
			<div class="chart-head">
				<h2>Findings แยกตามปี</h2>
				<button class="button" onclick={() => (showYearlyTable = !showYearlyTable)}>
					{showYearlyTable ? 'ซ่อนตาราง' : 'ดูตาราง'}
				</button>
			</div>

			{#if data.yearly.length === 0}
				<div class="empty">ยังไม่มีข้อมูลรายปี</div>
			{:else}
				<div class="legend">
					{#each SEVERITY_ORDER as sev}
						<span class="legend-item">
							<span class="legend-swatch sev-fill-{sev}"></span>
							{SEVERITY_LABEL[sev]}
						</span>
					{/each}
				</div>

				<div class="chart-plot vbar-chart">
					{#each data.yearly as y (y.year)}
						<div class="vbar-col">
							<div class="vbar-stack" style="height:{(y.total / maxYearTotal) * 100}%">
								{#each SEVERITY_ORDER as sev}
									{#if y[sev] > 0}
										<div
											class="vbar-seg sev-fill-{sev}"
											style="flex-grow:{y[sev]}"
											role="img"
											aria-label="{y.year} {SEVERITY_LABEL[sev]}: {y[sev]}"
											onmousemove={(e) => showTooltip(e, `${y.year} · ${SEVERITY_LABEL[sev]}: ${y[sev]}`)}
											onmouseleave={hideTooltip}
										></div>
									{/if}
								{/each}
							</div>
							<div class="vbar-total mono">{y.total}</div>
							<div class="vbar-axis mono">{y.year}</div>
						</div>
					{/each}

					{#if tooltip}
						<div class="chart-tooltip" style="left:{tooltip.x}px; top:{tooltip.y}px">
							{tooltip.text}
						</div>
					{/if}
				</div>

				{#if showYearlyTable}
					<div class="scroll" style="margin-top:1rem">
						<table>
							<thead>
								<tr>
									<th>Year</th>
									{#each SEVERITY_ORDER as sev}
										<th>{SEVERITY_LABEL[sev]}</th>
									{/each}
									<th>Total</th>
								</tr>
							</thead>
							<tbody>
								{#each data.yearly as y (y.year)}
									<tr>
										<td class="mono">{y.year}</td>
										{#each SEVERITY_ORDER as sev}
											<td class="mono">{y[sev]}</td>
										{/each}
										<td class="mono">{y.total}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			{/if}
		</div>
	{/if}
</div>

<style>
	.stat-row {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
		gap: 0.75rem;
		margin-bottom: 1.25rem;
	}

	.stat-tile {
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: 12px;
		padding: 1rem 1.1rem;
	}

	.stat-value {
		font-size: 1.8rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		line-height: 1.1;
	}

	.stat-label {
		color: var(--muted);
		font-size: 0.8rem;
		margin-top: 0.25rem;
	}

	.stat-sub {
		display: block;
		font-size: 0.72rem;
		opacity: 0.8;
	}

	.chart-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1rem;
	}

	.chart-head h2 {
		font-size: 1rem;
	}

	/* horizontal bar chart (severity totals) */
	.hbar-chart {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	.hbar-row {
		display: grid;
		grid-template-columns: 5.5rem 1fr 3.5rem;
		align-items: center;
		gap: 0.75rem;
	}

	.hbar-label {
		font-size: 0.78rem;
		font-weight: 600;
		text-align: right;
		justify-self: end;
	}

	.hbar-track {
		background: var(--code-bg);
		border-radius: 4px;
		height: 22px;
		overflow: hidden;
	}

	.hbar-fill {
		height: 100%;
		min-width: 4px;
		border-radius: 4px;
		transition: width 0.2s ease;
	}

	.hbar-value {
		font-size: 0.85rem;
		color: var(--text);
	}

	.hbar-row-btn {
		background: none;
		border: 1px solid transparent;
		border-radius: 6px;
		padding: 0.15rem 0.3rem;
		cursor: pointer;
		font: inherit;
		text-align: left;
		width: 100%;
	}
	.hbar-row-btn:hover:not(:disabled) {
		border-color: var(--border);
		background: var(--code-bg);
	}
	.hbar-row-btn.active {
		border-color: var(--accent);
		background: var(--code-bg);
	}
	.hbar-row-btn:disabled {
		cursor: default;
		opacity: 0.6;
	}

	.breakdown-panel {
		margin: 0.3rem 0 0.6rem;
		padding: 0.75rem 0.9rem;
		background: var(--code-bg);
		border: 1px solid var(--border);
		border-radius: 8px;
	}
	.breakdown-hint {
		font-size: 0.78rem;
		color: var(--muted);
		margin-bottom: 0.6rem;
	}
	.breakdown-list {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.breakdown-item {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.4rem 0.6rem;
		border-radius: 6px;
		text-decoration: none;
		color: var(--text);
		font-size: 0.85rem;
		background: var(--panel);
		border: 1px solid var(--border);
	}
	.breakdown-item:hover {
		border-color: var(--accent);
		color: var(--accent);
	}
	.breakdown-count {
		color: var(--muted);
		font-size: 0.8rem;
	}

	.sev-fill-critical {
		background: var(--critical);
	}
	.sev-fill-high {
		background: var(--high);
	}
	.sev-fill-medium {
		background: var(--medium);
	}
	.sev-fill-low {
		background: var(--low);
	}
	.sev-fill-info {
		background: var(--info);
	}

	/* legend */
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		margin-bottom: 1rem;
		font-size: 0.78rem;
		color: var(--muted);
	}

	.legend-item {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
	}

	.legend-swatch {
		width: 10px;
		height: 10px;
		border-radius: 3px;
		display: inline-block;
	}

	/* vertical stacked bar chart (yearly) */
	.chart-plot {
		position: relative;
	}

	.vbar-chart {
		display: flex;
		align-items: flex-end;
		gap: 1.25rem;
		height: 220px;
		padding-top: 1.5rem;
	}

	.vbar-col {
		flex: 1 1 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		height: 100%;
		min-width: 2.5rem;
	}

	.vbar-stack {
		width: 100%;
		max-width: 3.5rem;
		display: flex;
		flex-direction: column-reverse;
		border-radius: 4px;
		overflow: hidden;
		min-height: 2px;
	}

	.vbar-seg {
		width: 100%;
		border-bottom: 2px solid var(--panel);
	}
	.vbar-seg:first-child {
		border-bottom: none;
	}

	.vbar-total {
		font-size: 0.72rem;
		color: var(--muted);
		margin-top: 0.4rem;
	}

	.vbar-axis {
		font-size: 0.8rem;
		color: var(--text);
		margin-top: 0.2rem;
		font-weight: 600;
	}

	.chart-tooltip {
		position: absolute;
		transform: translate(-50%, -110%);
		background: var(--text);
		color: var(--panel);
		font-size: 0.75rem;
		padding: 0.35rem 0.6rem;
		border-radius: 6px;
		white-space: nowrap;
		pointer-events: none;
		z-index: 10;
	}
</style>
