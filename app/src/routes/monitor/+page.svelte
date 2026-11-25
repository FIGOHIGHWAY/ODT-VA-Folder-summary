<script>
	import { onMount, onDestroy } from 'svelte';
	import MetricChart from '$lib/MetricChart.svelte';

	const RANGES = [
		{ id: '1h', label: '1 ชั่วโมง', ms: 3_600_000, bucketMs: 60_000 },
		{ id: '24h', label: '24 ชั่วโมง', ms: 86_400_000, bucketMs: 300_000 },
		{ id: '7d', label: '7 วัน', ms: 7 * 86_400_000, bucketMs: 1_800_000 },
		{ id: '30d', label: '30 วัน', ms: 30 * 86_400_000, bucketMs: 7_200_000 }
	];
	const STATE_LABEL = {
		ok: 'ปกติ',
		warn: 'ควรตรวจสอบ',
		crit: 'วิกฤต',
		down: 'ติดต่อไม่ได้',
		unknown: 'รอข้อมูล'
	};

	let range = $state('24h');
	/** @type {any} */
	let data = $state(null);
	let loading = $state(false);
	let error = $state('');
	let timer = null;

	const rangeDef = $derived(RANGES.find((r) => r.id === range) ?? RANGES[1]);
	const alerts = $derived((data?.vms ?? []).filter((v) => ['warn', 'crit', 'down'].includes(v.state)));

	async function load(refresh = false) {
		loading = true;
		error = '';
		try {
			const res = await fetch(`/api/monitor?range=${range}${refresh ? '&refresh=1' : ''}`);
			const body = await res.json();
			if (!res.ok) throw new Error(body.error ?? 'โหลดข้อมูลไม่สำเร็จ');
			data = body;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	function selectRange(id) {
		range = id;
		try {
			localStorage.setItem('va-monitor-range', id);
		} catch {
			// per-viewer convenience only
		}
		load();
	}

	onMount(() => {
		try {
			const saved = localStorage.getItem('va-monitor-range');
			if (RANGES.some((r) => r.id === saved)) range = saved;
		} catch {
			// ignore
		}
		load();
		timer = setInterval(() => load(), 60_000);
	});
	onDestroy(() => timer && clearInterval(timer));

	function ago(ms) {
		if (!ms || !data) return '';
		const s = Math.round((data.now - ms) / 1000);
		if (s < 90) return 'เมื่อสักครู่';
		if (s < 3600) return `${Math.round(s / 60)} นาทีก่อน`;
		return `${Math.round(s / 3600)} ชั่วโมงก่อน`;
	}

	/** Level of one value against its thresholds, for colouring the figure. */
	function level(key, v) {
		if (v == null || !data) return '';
		const t = data.thresholds[key];
		return v >= t.crit ? 'crit' : v >= t.warn ? 'warn' : '';
	}
</script>

<svelte:head>
	<title>Monitor — VA Scan</title>
</svelte:head>

<div class="wrap">
	<a class="back-link" href="/scan">← หน้าสั่งสแกน</a>
	<div class="page-head">
		<div>
			<h1>Monitor เครื่องสแกน</h1>
			<p class="sub">ดิสก์ RAM และ CPU ของแต่ละเครื่อง เก็บทุก 1 นาที ย้อนหลัง 30 วัน</p>
		</div>
		<span class="spacer"></span>
		<div class="tabs" role="tablist" aria-label="ช่วงเวลา">
			{#each RANGES as r (r.id)}
				<button type="button" role="tab" aria-selected={range === r.id} onclick={() => selectRange(r.id)}>
					{r.label}
				</button>
			{/each}
		</div>
		<button type="button" class="button" disabled={loading} onclick={() => load(true)}>
			{loading ? '⏳' : '🔄'} อ่านค่าตอนนี้
		</button>
	</div>

	{#if error}
		<div class="banner crit">{error}</div>
	{/if}
	{#if data?.historyError}
		<div class="banner warn">
			ยังเก็บประวัติไม่ได้ (ต้องรัน migration 024 ก่อน) — ตอนนี้แสดงได้เฉพาะค่าล่าสุด
		</div>
	{/if}

	{#if alerts.length > 0}
		<section class="banner {alerts.some((a) => a.state !== 'warn') ? 'crit' : 'warn'}" aria-label="แจ้งเตือน">
			<b>⚠️ ต้องดู {alerts.length} เครื่อง</b>
			<ul>
				{#each alerts as a (a.id)}
					<li><b>{a.name}</b> — {a.reasons.join(' · ')}</li>
				{/each}
			</ul>
		</section>
	{:else if data}
		<div class="banner ok">✓ ทุกเครื่องปกติ</div>
	{/if}

	<div class="legend" aria-label="คำอธิบายสี">
		<span><i class="sw s1"></i>CPU</span>
		<span><i class="sw s2"></i>RAM</span>
		<span><i class="sw s3"></i>ดิสก์</span>
		<span class="muted">เส้นประ = เกณฑ์ดิสก์ {data?.thresholds?.disk.warn ?? 85}%</span>
	</div>

	<div class="grid">
		{#if !data}
			{#each ['VA Scan (prod)', 'OWASP ZAP', 'OpenVAS', 'Nuclei', 'Nessus'] as name}
				<div class="card loading"><b>{name}</b><span class="muted">กำลังโหลด...</span></div>
			{/each}
		{:else}
			{#each data.vms as vm (vm.id)}
				{@const s = vm.sample}
				<article class="card {vm.state}">
					<header class="card-head">
						<span class="dot {vm.state}" aria-hidden="true"></span>
						<div class="title">
							<b>{vm.name}</b>
							<span class="mono muted">{vm.host ?? '—'}{s?.cpus ? ` · ${s.cpus} CPU` : ''}</span>
						</div>
						<span class="spacer"></span>
						<span class="pill {vm.state}">{STATE_LABEL[vm.state] ?? vm.state}</span>
					</header>

					<dl class="now">
						<div>
							<dt><i class="sw s1"></i>CPU</dt>
							<dd class={level('cpu', s?.cpuPct)}>{s?.cpuPct != null ? `${s.cpuPct}%` : '—'}</dd>
						</div>
						<div>
							<dt><i class="sw s2"></i>RAM</dt>
							<dd class={level('mem', s?.mem?.usedPct)}>
								{s?.mem ? `${s.mem.usedPct}%` : '—'}
								{#if s?.mem}<small>{(s.mem.usedMb / 1024).toFixed(1)} / {s.mem.totalGb} GB</small>{/if}
							</dd>
						</div>
						<div>
							<dt><i class="sw s3"></i>ดิสก์</dt>
							<dd class={level('disk', s?.disk?.usedPct)}>
								{s?.disk ? `${s.disk.usedPct}%` : '—'}
								{#if s?.disk}<small>เหลือ {s.disk.freeGb} GB</small>{/if}
							</dd>
						</div>
					</dl>

					<MetricChart
						series={vm.series}
						rangeMs={rangeDef.ms}
						bucketMs={rangeDef.bucketMs}
						now={data.now}
						diskWarn={data.thresholds.disk.warn}
					/>

					<footer class="card-foot muted">
						{#if s}ค่าที่อ่านได้ล่าสุด {ago(s.at)}{/if}
						{#if s && !s.ok && s.error}
							<div class="err">ติดต่อไม่ได้: {s.error}</div>
						{/if}
					</footer>
				</article>
			{/each}
		{/if}
	</div>
</div>

<style>
	.wrap {
		max-width: 1100px;
		margin: 2rem auto;
		padding: 0 1.25rem;
		--s1: #2a78d6;
		--s2: #eb6834;
		--s3: #1baf7a;
	}
	@media (prefers-color-scheme: dark) {
		:global(:root:not([data-theme='light'])) .wrap {
			--s1: #3987e5;
			--s2: #d95926;
			--s3: #199e70;
		}
	}
	:global(:root[data-theme='dark']) .wrap {
		--s1: #3987e5;
		--s2: #d95926;
		--s3: #199e70;
	}
	.back-link {
		display: inline-block;
		margin-bottom: 1rem;
		color: var(--accent);
		text-decoration: none;
		font-size: 0.88rem;
	}
	.page-head {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
		margin-bottom: 1rem;
	}
	h1 {
		font-size: 1.3rem;
		margin: 0;
	}
	.sub {
		color: var(--muted);
		font-size: 0.86rem;
		margin: 0.2rem 0 0;
	}
	.spacer {
		flex: 1;
	}
	.muted {
		color: var(--muted);
	}
	.mono {
		font-family: var(--mono, monospace);
	}

	.tabs {
		display: inline-flex;
		border: 1px solid var(--border);
		border-radius: 8px;
		overflow: hidden;
	}
	.tabs button {
		font: inherit;
		font-size: 0.82rem;
		background: var(--bg);
		color: var(--muted);
		border: 0;
		padding: 0.4rem 0.75rem;
		cursor: pointer;
	}
	.tabs button + button {
		border-left: 1px solid var(--border);
	}
	.tabs button[aria-selected='true'] {
		background: var(--accent);
		color: var(--bg);
		font-weight: 600;
	}
	.button {
		font: inherit;
		font-size: 0.84rem;
		padding: 0.4rem 0.8rem;
		border-radius: 6px;
		border: 1px solid var(--border);
		background: var(--bg);
		color: var(--text);
		cursor: pointer;
	}
	.button:hover:not(:disabled) {
		border-color: var(--accent);
	}
	.button:disabled {
		opacity: 0.5;
	}

	.banner {
		border-radius: 8px;
		padding: 0.6rem 0.9rem;
		margin-bottom: 0.9rem;
		font-size: 0.86rem;
	}
	.banner ul {
		margin: 0.3rem 0 0;
		padding-left: 1.1rem;
	}
	.banner.ok {
		background: #16321f;
		color: #8be3a6;
	}
	.banner.warn {
		background: rgba(224, 176, 80, 0.14);
		color: #e0b050;
		border: 1px solid rgba(224, 176, 80, 0.4);
	}
	.banner.crit {
		background: rgba(241, 106, 106, 0.12);
		color: #f19a9a;
		border: 1px solid rgba(241, 106, 106, 0.45);
	}

	.legend {
		display: flex;
		gap: 1rem;
		flex-wrap: wrap;
		font-size: 0.8rem;
		margin-bottom: 0.6rem;
		align-items: center;
	}
	.legend span {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
	}
	.sw {
		display: inline-block;
		width: 12px;
		height: 3px;
		border-radius: 2px;
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

	.grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 1rem;
	}
	@media (max-width: 820px) {
		.grid {
			grid-template-columns: 1fr;
		}
	}
	.card {
		background: var(--panel-bg, var(--code-bg));
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 0.9rem 1rem 0.7rem;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		min-width: 0;
	}
	.card.warn {
		border-color: rgba(224, 176, 80, 0.55);
	}
	.card.crit,
	.card.down {
		border-color: rgba(241, 106, 106, 0.6);
	}
	.card.loading {
		opacity: 0.6;
		min-height: 220px;
	}
	.card-head {
		display: flex;
		align-items: center;
		gap: 0.55rem;
	}
	.title {
		display: flex;
		flex-direction: column;
		line-height: 1.25;
		min-width: 0;
	}
	.title .mono {
		font-size: 0.74rem;
	}
	.dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		flex: none;
		background: var(--muted);
	}
	.dot.ok {
		background: #3ecd7a;
	}
	.dot.warn {
		background: #e0b050;
	}
	.dot.crit,
	.dot.down {
		background: #f16a6a;
	}
	.pill {
		font-size: 0.72rem;
		font-weight: 600;
		padding: 0.12rem 0.55rem;
		border-radius: 999px;
		background: var(--bg);
		color: var(--muted);
		white-space: nowrap;
	}
	.pill.ok {
		background: #16321f;
		color: #8be3a6;
	}
	.pill.warn {
		background: rgba(224, 176, 80, 0.15);
		color: #e0b050;
	}
	.pill.crit,
	.pill.down {
		background: #3a1a1a;
		color: #f19a9a;
	}

	.now {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.5rem;
		margin: 0;
	}
	.now div {
		min-width: 0;
	}
	.now dt {
		font-size: 0.74rem;
		color: var(--muted);
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}
	.now dd {
		margin: 0.1rem 0 0;
		font-size: 1.25rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		display: flex;
		flex-direction: column;
		line-height: 1.2;
	}
	.now dd small {
		font-size: 0.72rem;
		font-weight: 400;
		color: var(--muted);
	}
	.now dd.warn {
		color: #e0b050;
	}
	.now dd.crit {
		color: #f16a6a;
	}
	.card-foot {
		font-size: 0.74rem;
	}
	.err {
		color: #f19a9a;
		margin-top: 0.2rem;
		overflow-wrap: anywhere;
	}
</style>
