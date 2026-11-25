<script>
	/**
	 * CPU / RAM / disk % over time for one machine, on a single 0–100% axis.
	 * Lines break across missing samples; hovering shows a crosshair and the
	 * three values at that moment.
	 * @type {{
	 *   series: { t: string, cpu: number|null, cpuMax?: number|null, mem: number|null, disk: number|null, ok?: boolean }[],
	 *   rangeMs: number, bucketMs: number, now: number, diskWarn?: number
	 * }}
	 */
	let { series, rangeMs, bucketMs, now, diskWarn = 85 } = $props();

	const W = 600;
	const H = 150;
	const PAD = { l: 34, r: 8, t: 8, b: 20 };
	const plotW = W - PAD.l - PAD.r;
	const plotH = H - PAD.t - PAD.b;

	const METRICS = [
		{ key: 'cpu', label: 'CPU', cls: 's1' },
		{ key: 'mem', label: 'RAM', cls: 's2' },
		{ key: 'disk', label: 'ดิสก์', cls: 's3' }
	];

	const start = $derived(now - rangeMs);
	const points = $derived(series.map((p) => ({ ...p, ms: new Date(p.t).getTime() })).filter((p) => p.ms >= start));

	const x = (ms) => PAD.l + ((ms - start) / rangeMs) * plotW;
	const y = (v) => PAD.t + (1 - Math.max(0, Math.min(100, v)) / 100) * plotH;

	/** SVG path for one metric, breaking the line at nulls and at gaps > 2.5 buckets. */
	function pathFor(key) {
		let d = '';
		let prevMs = null;
		for (const p of points) {
			const v = p[key];
			if (v == null) {
				prevMs = null;
				continue;
			}
			const move = prevMs == null || p.ms - prevMs > bucketMs * 2.5;
			d += `${move ? 'M' : 'L'}${x(p.ms).toFixed(1)},${y(v).toFixed(1)}`;
			prevMs = p.ms;
		}
		return d;
	}

	const fmtTick = (ms) => {
		const d = new Date(ms);
		return rangeMs > 2 * 86_400_000
			? d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })
			: d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
	};
	const ticks = $derived([0, 0.25, 0.5, 0.75, 1].map((f) => start + f * rangeMs));

	// ---- hover ----
	let hoverIdx = $state(-1);
	/** @type {SVGSVGElement|undefined} */
	let svgEl = $state();

	function onMove(e) {
		if (!svgEl || points.length === 0) return;
		const rect = svgEl.getBoundingClientRect();
		const px = ((e.clientX - rect.left) / rect.width) * W;
		const ms = start + ((px - PAD.l) / plotW) * rangeMs;
		let best = -1;
		let bestDist = Infinity;
		points.forEach((p, i) => {
			const dist = Math.abs(p.ms - ms);
			if (dist < bestDist) {
				bestDist = dist;
				best = i;
			}
		});
		hoverIdx = bestDist <= bucketMs * 3 ? best : -1;
	}

	const hover = $derived(hoverIdx >= 0 ? points[hoverIdx] : null);
	const fmtV = (v) => (v == null ? '—' : `${v}%`);
	const fmtWhen = (ms) =>
		new Date(ms).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
</script>

<div class="chart-wrap">
	{#if points.length === 0}
		<div class="empty">ยังไม่มีข้อมูลย้อนหลังในช่วงนี้</div>
	{/if}
	<svg
		bind:this={svgEl}
		viewBox="0 0 {W} {H}"
		role="img"
		aria-label="กราฟ CPU, RAM และดิสก์ เป็นเปอร์เซ็นต์ตามเวลา"
		onpointermove={onMove}
		onpointerleave={() => (hoverIdx = -1)}
	>
		{#each [0, 50, 100] as g}
			<line class="grid" x1={PAD.l} x2={W - PAD.r} y1={y(g)} y2={y(g)} />
			<text class="axis" x={PAD.l - 6} y={y(g) + 3.5} text-anchor="end">{g}%</text>
		{/each}
		<line class="warn-line" x1={PAD.l} x2={W - PAD.r} y1={y(diskWarn)} y2={y(diskWarn)} />
		<text class="axis warn-label" x={W - PAD.r - 2} y={y(diskWarn) - 3} text-anchor="end">{diskWarn}%</text>
		{#each ticks as tk, i}
			<text
				class="axis"
				x={x(tk)}
				y={H - 5}
				text-anchor={i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle'}>{fmtTick(tk)}</text
			>
		{/each}

		{#each METRICS as m}
			<path class="line {m.cls}" d={pathFor(m.key)} />
		{/each}

		{#if hover}
			<line class="crosshair" x1={x(hover.ms)} x2={x(hover.ms)} y1={PAD.t} y2={PAD.t + plotH} />
			{#each METRICS as m}
				{#if hover[m.key] != null}
					<circle class="dot {m.cls}" cx={x(hover.ms)} cy={y(hover[m.key])} r="4" />
				{/if}
			{/each}
		{/if}
		<rect class="hit" x={PAD.l} y={PAD.t} width={plotW} height={plotH} />
	</svg>

	{#if hover}
		<div class="tip" style="left:{(x(hover.ms) / W) * 100}%" class:flip={x(hover.ms) > W * 0.6}>
			<div class="tip-time">{fmtWhen(hover.ms)}</div>
			{#each METRICS as m}
				<div class="tip-row">
					<span class="sw {m.cls}"></span>{m.label}
					<b>{fmtV(hover[m.key])}</b>
					{#if m.key === 'cpu' && hover.cpuMax != null && hover.cpuMax !== hover.cpu}
						<span class="muted">สูงสุด {hover.cpuMax}%</span>
					{/if}
				</div>
			{/each}
			{#if hover.ok === false}<div class="tip-err">มีช่วงที่ติดต่อเครื่องไม่ได้</div>{/if}
		</div>
	{/if}
</div>

<style>
	.chart-wrap {
		position: relative;
		--s1: #2a78d6;
		--s2: #eb6834;
		--s3: #1baf7a;
	}
	@media (prefers-color-scheme: dark) {
		:global(:root:not([data-theme='light'])) .chart-wrap {
			--s1: #3987e5;
			--s2: #d95926;
			--s3: #199e70;
		}
	}
	:global(:root[data-theme='dark']) .chart-wrap {
		--s1: #3987e5;
		--s2: #d95926;
		--s3: #199e70;
	}
	svg {
		display: block;
		width: 100%;
		height: auto;
		touch-action: none;
	}
	.grid {
		stroke: var(--border);
		stroke-width: 1;
	}
	.warn-line {
		stroke: var(--muted);
		stroke-width: 1;
		stroke-dasharray: 3 4;
		opacity: 0.7;
	}
	.axis {
		fill: var(--muted);
		font-size: 10px;
		font-variant-numeric: tabular-nums;
	}
	.warn-label {
		font-size: 9px;
	}
	.line {
		fill: none;
		stroke-width: 2;
		stroke-linejoin: round;
		stroke-linecap: round;
	}
	.line.s1,
	.dot.s1 {
		stroke: var(--s1);
	}
	.line.s2,
	.dot.s2 {
		stroke: var(--s2);
	}
	.line.s3,
	.dot.s3 {
		stroke: var(--s3);
	}
	.dot {
		fill: var(--panel-bg, var(--code-bg));
		stroke-width: 2;
	}
	.crosshair {
		stroke: var(--muted);
		stroke-width: 1;
	}
	.hit {
		fill: transparent;
	}
	.empty {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		color: var(--muted);
		font-size: 0.8rem;
		pointer-events: none;
	}
	.tip {
		position: absolute;
		top: 0.25rem;
		transform: translateX(10px);
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 0.4rem 0.6rem;
		font-size: 0.75rem;
		pointer-events: none;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.18);
		white-space: nowrap;
		z-index: 2;
	}
	.tip.flip {
		transform: translateX(calc(-100% - 10px));
	}
	.tip-time {
		color: var(--muted);
		margin-bottom: 0.2rem;
	}
	.tip-row {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-variant-numeric: tabular-nums;
	}
	.tip-row b {
		margin-left: auto;
		padding-left: 0.75rem;
	}
	.tip-err {
		color: #f19a9a;
		margin-top: 0.2rem;
	}
	.muted {
		color: var(--muted);
	}
	.sw {
		width: 10px;
		height: 3px;
		border-radius: 2px;
		display: inline-block;
	}
	.sw.s1 {
		background: var(--s1);
	}
	.sw.s2 {
		background: var(--s2);
	}
	.sw.s3 {
		background: var(--s3);
	}
</style>
