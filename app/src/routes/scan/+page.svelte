<script>
	import { invalidateAll } from '$app/navigation';
	import { lang, t } from '$lib/i18n.js';
	import nessusLogo from '$lib/assets/tools/nessus-logo.png';
	import openvasLogo from '$lib/assets/tools/openvas-logo.svg';
	import nucleiLogo from '$lib/assets/tools/nuclei-logo.png';

	let openvasTarget = $state('');
	let openvasStatus = $state('idle'); // idle | starting | running | done | error
	let openvasError = $state('');
	let openvasResult = $state(null);
	let openvasPollTimer = null;

	function stopOpenvasPoll() {
		if (openvasPollTimer) clearTimeout(openvasPollTimer);
		openvasPollTimer = null;
	}

	async function pollOpenvasScan(taskId) {
		try {
			const res = await fetch(`/api/openvas/scan/${taskId}/status`);
			const body = await res.json();
			if (!res.ok) {
				openvasStatus = 'error';
				openvasError = body.error ?? 'ดึงผลสแกนไม่สำเร็จ';
				return;
			}
			if (body.imported) {
				openvasStatus = 'done';
				openvasResult = body;
				await invalidateAll();
				return;
			}
			if (body.status === 'Stopped' || body.status === 'Interrupted') {
				openvasStatus = 'error';
				openvasError = `สแกนถูกยกเลิก (${body.status})`;
				return;
			}
			openvasStatus = 'running';
			openvasPollTimer = setTimeout(() => pollOpenvasScan(taskId), 5000);
		} catch (err) {
			openvasStatus = 'error';
			openvasError = err instanceof Error ? err.message : String(err);
		}
	}

	async function startOpenvasScan() {
		const targets = openvasTarget.trim();
		if (!targets) return;
		stopOpenvasPoll();
		openvasStatus = 'starting';
		openvasError = '';
		openvasResult = null;
		try {
			const res = await fetch('/api/openvas/scan', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ targets })
			});
			const body = await res.json();
			if (!res.ok) {
				openvasStatus = 'error';
				openvasError = body.error ?? 'สั่งสแกนไม่สำเร็จ';
				return;
			}
			openvasStatus = 'running';
			pollOpenvasScan(body.taskId);
		} catch (err) {
			openvasStatus = 'error';
			openvasError = err instanceof Error ? err.message : String(err);
		}
	}

	let nucleiTarget = $state('');
	let nucleiStatus = $state('idle'); // idle | starting | running | done | error
	let nucleiError = $state('');
	let nucleiResult = $state(null);
	let nucleiPollTimer = null;

	function stopNucleiPoll() {
		if (nucleiPollTimer) clearTimeout(nucleiPollTimer);
		nucleiPollTimer = null;
	}

	async function pollNucleiScan(jobId) {
		try {
			const res = await fetch(`/api/nuclei/scan/${jobId}/status`);
			const body = await res.json();
			if (!res.ok) {
				nucleiStatus = 'error';
				nucleiError = body.error ?? 'ดึงผลสแกนไม่สำเร็จ';
				return;
			}
			if (body.imported) {
				nucleiStatus = 'done';
				nucleiResult = body;
				await invalidateAll();
				return;
			}
			if (body.status === 'error') {
				nucleiStatus = 'error';
				nucleiError = body.error ?? 'สแกนล้มเหลว';
				return;
			}
			nucleiStatus = 'running';
			nucleiPollTimer = setTimeout(() => pollNucleiScan(jobId), 5000);
		} catch (err) {
			nucleiStatus = 'error';
			nucleiError = err instanceof Error ? err.message : String(err);
		}
	}

	async function startNucleiScan() {
		const targets = nucleiTarget.trim();
		if (!targets) return;
		stopNucleiPoll();
		nucleiStatus = 'starting';
		nucleiError = '';
		nucleiResult = null;
		try {
			const res = await fetch('/api/nuclei/scan', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ targets })
			});
			const body = await res.json();
			if (!res.ok) {
				nucleiStatus = 'error';
				nucleiError = body.error ?? 'สั่งสแกนไม่สำเร็จ';
				return;
			}
			nucleiStatus = 'running';
			pollNucleiScan(body.jobId);
		} catch (err) {
			nucleiStatus = 'error';
			nucleiError = err instanceof Error ? err.message : String(err);
		}
	}

	// Disabled: the Nessus VM's current Professional license has "scan_api"
	// turned off, so POST /scans is rejected with 412 "API is not available"
	// even though the API key itself authenticates fine. Re-enable once
	// Tenable confirms scan-via-API is licensed on that activation.
	const NESSUS_SCAN_ENABLED = false;

	let nessusTarget = $state('');
	let nessusStatus = $state('idle'); // idle | starting | running | done | error
	let nessusError = $state('');
	let nessusResult = $state(null);
	let nessusPollTimer = null;

	function stopNessusPoll() {
		if (nessusPollTimer) clearTimeout(nessusPollTimer);
		nessusPollTimer = null;
	}

	async function pollNessusScan(scanId) {
		try {
			const res = await fetch(`/api/nessus/scan/${scanId}/status`);
			const body = await res.json();
			if (!res.ok) {
				nessusStatus = 'error';
				nessusError = body.error ?? 'ดึงผลสแกนไม่สำเร็จ';
				return;
			}
			if (body.imported) {
				nessusStatus = 'done';
				nessusResult = body;
				await invalidateAll();
				return;
			}
			if (body.status === 'canceled' || body.status === 'aborted') {
				nessusStatus = 'error';
				nessusError = `สแกนถูกยกเลิก (${body.status})`;
				return;
			}
			nessusStatus = 'running';
			nessusPollTimer = setTimeout(() => pollNessusScan(scanId), 5000);
		} catch (err) {
			nessusStatus = 'error';
			nessusError = err instanceof Error ? err.message : String(err);
		}
	}

	async function startNessusScan() {
		const targets = nessusTarget.trim();
		if (!targets) return;
		stopNessusPoll();
		nessusStatus = 'starting';
		nessusError = '';
		nessusResult = null;
		try {
			const res = await fetch('/api/nessus/scan', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ targets })
			});
			const body = await res.json();
			if (!res.ok) {
				nessusStatus = 'error';
				nessusError = body.error ?? 'สั่งสแกนไม่สำเร็จ';
				return;
			}
			nessusStatus = 'running';
			pollNessusScan(body.scanId);
		} catch (err) {
			nessusStatus = 'error';
			nessusError = err instanceof Error ? err.message : String(err);
		}
	}
</script>

<svelte:head>
	<title>สั่งสแกน — VA Scan</title>
</svelte:head>

<div class="wrap">
	<a class="back-link" href="/">← กลับหน้าแรก</a>
	<h1>สั่งสแกน</h1>
	<p class="hint">สั่งสแกนหาช่องโหว่จากเครื่องมือที่เชื่อมต่อไว้ แล้วดึงผลกลับมา import เข้าระบบให้อัตโนมัติ</p>

	{#if NESSUS_SCAN_ENABLED}
		<div class="panel">
			<h2><img src={nessusLogo} alt="Nessus" class="tool-logo" /> สั่งสแกนด้วย Nessus</h2>
			<p class="sub">
				พิมพ์ IP หรือโดเมนของเป้าหมาย ระบบจะสั่ง Nessus เริ่มสแกน แล้วดึงผลกลับมา import
				เข้าระบบให้อัตโนมัติเมื่อสแกนเสร็จ
			</p>
			<div style="display:flex; gap:.5rem; flex-wrap:wrap; align-items:center">
				<input
					type="text"
					bind:value={nessusTarget}
					placeholder="เช่น 10.1.2.3 หรือ example.kku.ac.th"
					disabled={nessusStatus === 'starting' || nessusStatus === 'running'}
					style="flex:1; min-width:220px; padding:.5rem; border-radius:6px; border:1px solid var(--border); background:var(--bg); color:var(--text)"
				/>
				<button
					type="button"
					class="button"
					disabled={!nessusTarget.trim() || nessusStatus === 'starting' || nessusStatus === 'running'}
					onclick={startNessusScan}
				>
					{nessusStatus === 'starting' || nessusStatus === 'running' ? '⏳ กำลังสแกน...' : '🛰️ เริ่มสแกน'}
				</button>
			</div>

			{#if nessusStatus === 'running'}
				<div class="status"><span class="badge">กำลังสแกน... ระบบจะดึงผลอัตโนมัติเมื่อเสร็จ</span></div>
			{:else if nessusStatus === 'error'}
				<div class="status"><span class="badge err">สแกนล้มเหลว</span></div>
				<div class="err-box">{nessusError}</div>
			{:else if nessusStatus === 'done' && nessusResult}
				{#if nessusResult.duplicate}
					<div class="status">
						<span class="badge">{t($lang, 'home_already_imported')}</span>
						<a class="button" href="/reports/{nessusResult.existingReportId}">
							{t($lang, 'home_view_original')}
						</a>
					</div>
				{:else}
					<div class="status">
						<span class="badge ok">นำเข้าผลสแกนสำเร็จ</span>
						<span style="color:var(--muted)">{nessusResult.insertedCount} finding(s)</span>
						<a class="button" href="/reports/{nessusResult.reportId}">{t($lang, 'home_view_detail')}</a>
					</div>
				{/if}
			{/if}
		</div>
	{/if}

	<div class="panel">
		<h2><img src={openvasLogo} alt="OpenVAS" class="tool-logo" /> สั่งสแกนด้วย OpenVAS</h2>
		<p class="sub">
			พิมพ์ IP หรือโดเมนของเป้าหมาย ระบบจะสั่ง OpenVAS เริ่มสแกน แล้วดึงผลกลับมา import
			เข้าระบบให้อัตโนมัติเมื่อสแกนเสร็จ
		</p>
		<div style="display:flex; gap:.5rem; flex-wrap:wrap; align-items:center">
			<input
				type="text"
				bind:value={openvasTarget}
				placeholder="เช่น 10.1.2.3 หรือ example.kku.ac.th"
				disabled={openvasStatus === 'starting' || openvasStatus === 'running'}
				style="flex:1; min-width:220px; padding:.5rem; border-radius:6px; border:1px solid var(--border); background:var(--bg); color:var(--text)"
			/>
			<button
				type="button"
				class="button"
				disabled={!openvasTarget.trim() ||
					openvasStatus === 'starting' ||
					openvasStatus === 'running'}
				onclick={startOpenvasScan}
			>
				{openvasStatus === 'starting' || openvasStatus === 'running'
					? '⏳ กำลังสแกน...'
					: '🛡️ เริ่มสแกน'}
			</button>
		</div>

		{#if openvasStatus === 'running'}
			<div class="status"><span class="badge">กำลังสแกน... ระบบจะดึงผลอัตโนมัติเมื่อเสร็จ</span></div>
		{:else if openvasStatus === 'error'}
			<div class="status"><span class="badge err">สแกนล้มเหลว</span></div>
			<div class="err-box">{openvasError}</div>
		{:else if openvasStatus === 'done' && openvasResult}
			{#if openvasResult.duplicate}
				<div class="status">
					<span class="badge">{t($lang, 'home_already_imported')}</span>
					<a class="button" href="/reports/{openvasResult.existingReportId}">
						{t($lang, 'home_view_original')}
					</a>
				</div>
			{:else}
				<div class="status">
					<span class="badge ok">นำเข้าผลสแกนสำเร็จ</span>
					<span style="color:var(--muted)">{openvasResult.insertedCount} finding(s)</span>
					<a class="button" href="/reports/{openvasResult.reportId}">{t($lang, 'home_view_detail')}</a>
				</div>
			{/if}
		{/if}
	</div>

	<div class="panel">
		<h2><img src={nucleiLogo} alt="Nuclei" class="tool-logo" /> สั่งสแกนด้วย Nuclei</h2>
		<p class="sub">
			พิมพ์ IP หรือโดเมนของเป้าหมาย ระบบจะสั่ง Nuclei เริ่มสแกน แล้วดึงผลกลับมา import
			เข้าระบบให้อัตโนมัติเมื่อสแกนเสร็จ
		</p>
		<div style="display:flex; gap:.5rem; flex-wrap:wrap; align-items:center">
			<input
				type="text"
				bind:value={nucleiTarget}
				placeholder="เช่น 10.1.2.3 หรือ https://example.kku.ac.th"
				disabled={nucleiStatus === 'starting' || nucleiStatus === 'running'}
				style="flex:1; min-width:220px; padding:.5rem; border-radius:6px; border:1px solid var(--border); background:var(--bg); color:var(--text)"
			/>
			<button
				type="button"
				class="button"
				disabled={!nucleiTarget.trim() ||
					nucleiStatus === 'starting' ||
					nucleiStatus === 'running'}
				onclick={startNucleiScan}
			>
				{nucleiStatus === 'starting' || nucleiStatus === 'running'
					? '⏳ กำลังสแกน...'
					: '🎯 เริ่มสแกน'}
			</button>
		</div>

		{#if nucleiStatus === 'running'}
			<div class="status"><span class="badge">กำลังสแกน... ระบบจะดึงผลอัตโนมัติเมื่อเสร็จ</span></div>
		{:else if nucleiStatus === 'error'}
			<div class="status"><span class="badge err">สแกนล้มเหลว</span></div>
			<div class="err-box">{nucleiError}</div>
		{:else if nucleiStatus === 'done' && nucleiResult}
			{#if nucleiResult.duplicate}
				<div class="status">
					<span class="badge">{t($lang, 'home_already_imported')}</span>
					<a class="button" href="/reports/{nucleiResult.existingReportId}">
						{t($lang, 'home_view_original')}
					</a>
				</div>
			{:else}
				<div class="status">
					<span class="badge ok">นำเข้าผลสแกนสำเร็จ</span>
					<span style="color:var(--muted)">{nucleiResult.insertedCount} finding(s)</span>
					<a class="button" href="/reports/{nucleiResult.reportId}">{t($lang, 'home_view_detail')}</a>
				</div>
			{/if}
		{/if}
	</div>
</div>

<style>
	.wrap {
		max-width: 820px;
		margin: 2rem auto;
		padding: 0 1.25rem;
	}
	.back-link {
		display: inline-block;
		margin-bottom: 1rem;
		color: var(--accent);
		text-decoration: none;
		font-size: 0.88rem;
	}
	.back-link:hover {
		text-decoration: underline;
	}
	h1 {
		font-size: 1.3rem;
		margin-bottom: 0.5rem;
	}
	.hint {
		color: var(--muted);
		font-size: 0.9rem;
		margin-bottom: 1.25rem;
	}
	.panel {
		background: var(--panel-bg, var(--code-bg));
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 1.25rem;
		margin-bottom: 1.25rem;
	}
	.panel h2 {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		font-size: 1.05rem;
		margin-bottom: 0.5rem;
	}
	.tool-logo {
		height: 24px;
		width: auto;
		max-width: 110px;
		object-fit: contain;
	}
	.sub {
		color: var(--muted);
		font-size: 0.88rem;
		margin-bottom: 0.9rem;
	}
	.status {
		margin-top: 0.9rem;
		display: flex;
		gap: 0.5rem;
		align-items: center;
		flex-wrap: wrap;
	}
	.badge {
		padding: 0.2rem 0.6rem;
		border-radius: 999px;
		background: var(--code-bg);
		font-size: 0.8rem;
	}
	.badge.ok {
		background: #16321f;
		color: #8be3a6;
	}
	.badge.err {
		background: #3a1a1a;
		color: #f19a9a;
	}
	.err-box {
		margin-top: 0.5rem;
		padding: 0.6rem 0.9rem;
		border-radius: 6px;
		background: #3a1a1a;
		color: #f19a9a;
		font-size: 0.85rem;
		white-space: pre-wrap;
	}
	.button {
		display: inline-block;
		padding: 0.45rem 0.9rem;
		border-radius: 6px;
		border: 1px solid var(--border);
		background: var(--bg);
		color: var(--text);
		cursor: pointer;
		font-size: 0.88rem;
		text-decoration: none;
	}
	.button:hover {
		border-color: var(--accent);
	}
	.button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
