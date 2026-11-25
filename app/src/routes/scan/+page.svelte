<script>
	import { onDestroy } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { lang, t } from '$lib/i18n.js';
	import nessusLogo from '$lib/assets/tools/nessus-logo.png';
	import openvasLogo from '$lib/assets/tools/openvas-logo.svg';
	import nucleiLogo from '$lib/assets/tools/nuclei-logo.png';
	import zapLogo from '$lib/assets/tools/zap-logo.svg';
	import HostResolver from '$lib/HostResolver.svelte';
	import { parseZapTargets, parseNucleiTargets } from '$lib/scanTargets.js';

	let { data } = $props();

	const TOOL_LABEL = { nessus: 'Nessus', openvas: 'OpenVAS', nuclei: 'Nuclei', zap: 'ZAP' };
	const STATUS_LABEL = { running: '⏳ กำลังสแกน', done: '✅ สำเร็จ', error: '❌ ล้มเหลว' };
	const TARGET_PHASE_LABEL = {
		spider: 'crawl',
		'active-scan': 'active',
		'fetching-alerts': 'ดึงผล'
	};

	// Disabled: the Nessus VM's current Professional license has "scan_api"
	// turned off, so POST /scans is rejected with 412 "API is not available"
	// even though the API key itself authenticates fine. Re-enable once
	// Tenable confirms scan-via-API is licensed on that activation.
	const NESSUS_SCAN_ENABLED = false;

	/** @type {string} one of zap | openvas | nuclei | nessus */
	let activeTab = $state('zap');

	/** Targets may be typed one per line; every tool's API expects a comma list. */
	function normalizeTargets(raw) {
		return String(raw)
			.split(/[\n,]+/)
			.map((s) => s.trim())
			.filter(Boolean)
			.join(', ');
	}

	function countTargets(raw) {
		return String(raw)
			.split(/[\n,]+/)
			.map((s) => s.trim())
			.filter(Boolean).length;
	}

	function fmtTime(d) {
		return new Date(d).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });
	}

	// ---- Live status sidebar ----------------------------------------------
	const runningJobs = $derived(data.jobs.filter((j) => j.status === 'running'));
	const recentJobs = $derived(data.jobs.filter((j) => j.status !== 'running').slice(0, 6));
	let showHistory = $state(false);

	// Refresh the sidebar every 5s while anything is running, so scans started
	// earlier (or by someone else) show live progress without a manual reload.
	let refreshTimer = null;
	$effect(() => {
		const anyRunning = runningJobs.length > 0;
		if (anyRunning && !refreshTimer) {
			refreshTimer = setInterval(() => invalidateAll(), 5000);
		} else if (!anyRunning && refreshTimer) {
			clearInterval(refreshTimer);
			refreshTimer = null;
		}
	});
	onDestroy(() => {
		if (refreshTimer) clearInterval(refreshTimer);
		stopOpenvasPoll();
		stopZapPoll();
		stopNucleiPoll();
		stopNessusPoll();
	});

	let cancellingJobs = $state(new Set());

	/** Cancel a running job from the sidebar/history (a scan started in an
	 * earlier page session, so there's no in-memory client state for it). */
	async function cancelHistoryJob(job) {
		if (!confirm(`ยกเลิกการสแกน ${TOOL_LABEL[job.tool] ?? job.tool} ของ ${job.target}?`)) return;
		cancellingJobs = new Set(cancellingJobs).add(job.id);
		try {
			await fetch(`/api/${job.tool}/scan/${job.external_id}`, { method: 'DELETE' });
			await invalidateAll();
		} finally {
			const next = new Set(cancellingJobs);
			next.delete(job.id);
			cancellingJobs = next;
		}
	}

	// ---- IP groups ----------------------------------------------------------
	let ipGroups = $state(data.ipGroups);
	let newGroupName = $state('');
	let newGroupTargets = $state('');
	let groupError = $state('');
	let groupBusy = $state(false);

	async function createGroup() {
		const name = newGroupName.trim();
		const targets = normalizeTargets(newGroupTargets);
		if (!name || !targets) return;
		groupBusy = true;
		groupError = '';
		try {
			const res = await fetch('/api/ip-groups', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name, targets })
			});
			const body = await res.json();
			if (!res.ok) {
				groupError = body.error ?? 'สร้างกลุ่มไม่สำเร็จ';
				return;
			}
			newGroupName = '';
			newGroupTargets = '';
			const listRes = await fetch('/api/ip-groups');
			ipGroups = (await listRes.json()).groups;
		} finally {
			groupBusy = false;
		}
	}

	async function deleteGroup(id) {
		if (!confirm('ลบกลุ่มนี้ทิ้ง?')) return;
		await fetch(`/api/ip-groups/${id}`, { method: 'DELETE' });
		ipGroups = ipGroups.filter((g) => g.id !== id);
	}

	/** Append a saved group's targets to a field (one per line, no duplicates). */
	function insertGroup(groupId, current) {
		const group = ipGroups.find((g) => g.id === Number(groupId));
		if (!group) return current;
		const existing = String(current)
			.split(/[\n,]+/)
			.map((s) => s.trim())
			.filter(Boolean);
		const added = String(group.targets)
			.split(/[\n,]+/)
			.map((s) => s.trim())
			.filter((s) => s && !existing.includes(s));
		return [...existing, ...added].join('\n');
	}

	// ---- OpenVAS ------------------------------------------------------------
	let openvasTarget = $state('');
	let openvasStatus = $state('idle'); // idle | starting | running | done | error
	let openvasPercent = $state(null);
	let openvasError = $state('');
	let openvasResult = $state(null);
	let openvasJobId = $state(null);
	let openvasCancelling = $state(false);
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
			openvasPercent = typeof body.percent === 'number' ? body.percent : null;
			openvasPollTimer = setTimeout(() => pollOpenvasScan(taskId), 5000);
		} catch (err) {
			openvasStatus = 'error';
			openvasError = err instanceof Error ? err.message : String(err);
		}
	}

	async function startOpenvasScan() {
		const targets = normalizeTargets(openvasTarget);
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
			openvasJobId = body.taskId;
			await invalidateAll();
			pollOpenvasScan(body.taskId);
		} catch (err) {
			openvasStatus = 'error';
			openvasError = err instanceof Error ? err.message : String(err);
		}
	}

	async function cancelOpenvasScan() {
		if (!openvasJobId) return;
		openvasCancelling = true;
		try {
			await fetch(`/api/openvas/scan/${openvasJobId}`, { method: 'DELETE' });
			stopOpenvasPoll();
			openvasStatus = 'error';
			openvasError = 'ยกเลิกโดยผู้ใช้';
			await invalidateAll();
		} finally {
			openvasCancelling = false;
		}
	}

	// ---- ZAP ----------------------------------------------------------------
	let zapTarget = $state('');
	const zapParsed = $derived(parseZapTargets(zapTarget));
	let zapStatus = $state('idle'); // idle | starting | running | done | error
	let zapPhase = $state('');
	let zapProgress = $state('');
	let zapPercent = $state(null);
	let zapError = $state('');
	let zapResult = $state(null);
	let zapJobId = $state(null);
	let zapCancelling = $state(false);
	let zapPollTimer = null;

	/** Append a line to a target field, skipping it if already present. */
	function appendLine(current, line) {
		const lines = String(current)
			.split('\n')
			.map((s) => s.trim())
			.filter(Boolean);
		if (!lines.includes(line)) lines.push(line);
		return lines.join('\n');
	}

	function stopZapPoll() {
		if (zapPollTimer) clearTimeout(zapPollTimer);
		zapPollTimer = null;
	}

	const ZAP_PHASE_LABEL = {
		spider: 'กำลัง crawl หน้าเว็บ (spider)',
		'active-scan': 'กำลังสแกนหาช่องโหว่ (active scan)',
		'fetching-alerts': 'กำลังดึงผลลัพธ์',
		importing: 'กำลังบันทึกผลเข้าระบบ'
	};

	async function pollZapScan(jobId) {
		try {
			const res = await fetch(`/api/zap/scan/${jobId}/status`);
			const body = await res.json();
			if (!res.ok) {
				zapStatus = 'error';
				zapError = body.error ?? 'ดึงผลสแกนไม่สำเร็จ';
				return;
			}
			if (body.imported) {
				zapStatus = 'done';
				zapResult = body;
				await invalidateAll();
				return;
			}
			if (body.status === 'error') {
				zapStatus = 'error';
				zapError = body.error ?? 'สแกนล้มเหลว';
				return;
			}
			zapStatus = 'running';
			zapPhase = body.phase ?? '';
			zapProgress = body.progress ?? '';
			zapPercent = typeof body.percent === 'number' ? body.percent : null;
			zapPollTimer = setTimeout(() => pollZapScan(jobId), 5000);
		} catch (err) {
			zapStatus = 'error';
			zapError = err instanceof Error ? err.message : String(err);
		}
	}

	async function startZapScan() {
		// Sent raw: each line may be "URL IP", which the server parses itself.
		const targets = zapTarget.trim();
		if (!targets || zapParsed.errors.length > 0) return;
		stopZapPoll();
		zapStatus = 'starting';
		zapError = '';
		zapResult = null;
		try {
			const res = await fetch('/api/zap/scan', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ targets })
			});
			const body = await res.json();
			if (!res.ok) {
				zapStatus = 'error';
				zapError = body.error ?? 'สั่งสแกนไม่สำเร็จ';
				return;
			}
			zapStatus = 'running';
			zapJobId = body.jobId;
			await invalidateAll();
			pollZapScan(body.jobId);
		} catch (err) {
			zapStatus = 'error';
			zapError = err instanceof Error ? err.message : String(err);
		}
	}

	async function cancelZapScan() {
		if (!zapJobId) return;
		zapCancelling = true;
		try {
			await fetch(`/api/zap/scan/${zapJobId}`, { method: 'DELETE' });
			stopZapPoll();
			zapStatus = 'error';
			zapError = 'ยกเลิกโดยผู้ใช้';
			await invalidateAll();
		} finally {
			zapCancelling = false;
		}
	}

	// ---- Nuclei -------------------------------------------------------------
	let nucleiTarget = $state('');
	let nucleiCveId = $state('');
	let nucleiHostHeader = $state('');
	let nucleiStatus = $state('idle'); // idle | starting | running | done | error
	let nucleiError = $state('');
	let nucleiResult = $state(null);
	let nucleiJobId = $state(null);
	let nucleiCancelling = $state(false);
	let nucleiPercent = $state(null);
	let nucleiPollTimer = null;
	let nucleiAdvancedOpen = $state(false);
	const nucleiParsed = $derived(parseNucleiTargets(nucleiTarget, nucleiHostHeader.trim().toLowerCase() || null));
	const nucleiPairCount = $derived(nucleiParsed.groups.filter((g) => g.hostHeader).length);

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
			nucleiPercent = typeof body.percent === 'number' ? body.percent : null;
			nucleiPollTimer = setTimeout(() => pollNucleiScan(jobId), 5000);
		} catch (err) {
			nucleiStatus = 'error';
			nucleiError = err instanceof Error ? err.message : String(err);
		}
	}

	async function startNucleiScan() {
		// Sent raw: each line may be "IP name", which the server parses itself.
		const targets = nucleiTarget.trim();
		if (!targets || nucleiParsed.errors.length > 0) return;
		stopNucleiPoll();
		nucleiStatus = 'starting';
		nucleiError = '';
		nucleiResult = null;
		try {
			const res = await fetch('/api/nuclei/scan', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					targets,
					cveId: nucleiCveId.trim() || undefined,
					hostHeader: nucleiHostHeader.trim() || undefined
				})
			});
			const body = await res.json();
			if (!res.ok) {
				nucleiStatus = 'error';
				nucleiError = body.error ?? 'สั่งสแกนไม่สำเร็จ';
				return;
			}
			nucleiStatus = 'running';
			nucleiJobId = body.jobId;
			await invalidateAll();
			pollNucleiScan(body.jobId);
		} catch (err) {
			nucleiStatus = 'error';
			nucleiError = err instanceof Error ? err.message : String(err);
		}
	}

	async function cancelNucleiScan() {
		if (!nucleiJobId) return;
		nucleiCancelling = true;
		try {
			await fetch(`/api/nuclei/scan/${nucleiJobId}`, { method: 'DELETE' });
			stopNucleiPoll();
			nucleiStatus = 'error';
			nucleiError = 'ยกเลิกโดยผู้ใช้';
			await invalidateAll();
		} finally {
			nucleiCancelling = false;
		}
	}

	// ---- Nessus (disabled, see NESSUS_SCAN_ENABLED) -------------------------
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
		const targets = normalizeTargets(nessusTarget);
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

	const busy = (s) => s === 'starting' || s === 'running';
	const TABS = $derived([
		{ id: 'zap', label: 'ZAP', sub: 'เว็บแอป', logo: zapLogo, status: zapStatus },
		{ id: 'openvas', label: 'OpenVAS', sub: 'เครื่อง/IP', logo: openvasLogo, status: openvasStatus },
		{ id: 'nuclei', label: 'Nuclei', sub: 'CVE', logo: nucleiLogo, status: nucleiStatus },
		{ id: 'nessus', label: 'Nessus', sub: 'ปิดอยู่', logo: nessusLogo, status: nessusStatus, disabled: !NESSUS_SCAN_ENABLED }
	]);
</script>

<svelte:head>
	<title>สั่งสแกน — VA Scan</title>
</svelte:head>

{#snippet groupPicker(current, set, isBusy)}
	{#if ipGroups.length > 0}
		<select
			class="inline-select"
			aria-label="แทรกกลุ่ม IP"
			disabled={isBusy}
			onchange={(e) => {
				set(insertGroup(e.currentTarget.value, current));
				e.currentTarget.value = '';
			}}
		>
			<option value="">📁 แทรกกลุ่ม IP…</option>
			{#each ipGroups as group (group.id)}
				<option value={group.id}>{group.name}</option>
			{/each}
		</select>
	{/if}
{/snippet}

{#snippet outcome(status, err, result)}
	{#if status === 'error'}
		<div class="err-box">❌ {err}</div>
	{:else if status === 'done' && result}
		<div class="status">
			{#if result.duplicate}
				<span class="pill">{t($lang, 'home_already_imported')}</span>
				<a class="button" href="/reports/{result.existingReportId}">{t($lang, 'home_view_original')}</a>
			{:else}
				<span class="pill ok">✓ นำเข้าผลสำเร็จ · {result.insertedCount} finding(s)</span>
				<a class="button" href="/reports/{result.reportId}">{t($lang, 'home_view_detail')}</a>
			{/if}
		</div>
	{/if}
{/snippet}

{#snippet parsePreview(errors, pairs, pairLabel)}
	{#if errors.length > 0}
		<ul class="parse-errors">
			{#each errors as e}<li>⚠️ {e}</li>{/each}
		</ul>
	{/if}
	{#if pairs.length > 0}
		<div class="pairs">
			<span class="pairs-head">{pairLabel} {pairs.length} คู่</span>
			<ul>
				{#each pairs as p (p.name + p.ip)}
					<li><code>{p.name}</code><span class="arrow">→</span><code>{p.ip}</code></li>
				{/each}
			</ul>
		</div>
	{/if}
{/snippet}

{#snippet progress(percent, small = false)}
	{#if typeof percent === 'number'}
		<div class="bar" class:bar-sm={small} role="progressbar" aria-valuenow={percent} aria-valuemin="0" aria-valuemax="100">
			<i style="width:{percent}%"></i>
		</div>
	{/if}
{/snippet}

<div class="wrap">
	<a class="back-link" href="/">← กลับหน้าแรก</a>
	<div class="page-head">
		<h1>สั่งสแกน</h1>
		{#if runningJobs.length > 0}
			<span class="pill run">⏳ กำลังสแกน {runningJobs.length} งาน</span>
		{/if}
	</div>

	<div class="split">
		<!-- ================= Left: scan form ================= -->
		<section class="panel">
			<div class="tabs" role="tablist" aria-label="เลือกเครื่องมือสแกน">
				{#each TABS as tab (tab.id)}
					<button
						type="button"
						role="tab"
						aria-selected={activeTab === tab.id}
						disabled={tab.disabled}
						title={tab.disabled ? 'license ปัจจุบันไม่รองรับการสั่งสแกนผ่าน API — นำเข้าไฟล์ผลได้ที่หน้าแรก' : ''}
						onclick={() => (activeTab = tab.id)}
					>
						<img src={tab.logo} alt="" class="tab-logo" />
						<span class="tab-text">
							<b>{tab.label}</b>
							<small>{tab.sub}</small>
						</span>
						{#if busy(tab.status)}<span class="dot" aria-label="กำลังสแกน"></span>{/if}
					</button>
				{/each}
			</div>

			{#if activeTab === 'zap'}
				<div class="tab-body">
					<p class="sub">
						สแกนเว็บแอป: crawl หน้าเว็บ (spider) แล้วหาช่องโหว่ (active scan) สแกนได้สูงสุด 5 เว็บพร้อมกัน
						ผลนำเข้าระบบอัตโนมัติเมื่อเสร็จ
					</p>
					<label class="field" for="zap-target">
						URL เป้าหมาย
						<span class="count">
							{zapParsed.urls.length ? `${zapParsed.urls.length} เว็บ` : ''}
							{zapParsed.pins.length ? ` · ปัก ${zapParsed.pins.length}` : ''}
						</span>
					</label>
					<textarea
						id="zap-target"
						rows="4"
						bind:value={zapTarget}
						placeholder={'https://example.kku.ac.th\nhttps://web1.kku.ac.th 10.101.102.34\nhttps://web2.kku.ac.th 10.101.102.35'}
						disabled={busy(zapStatus)}
					></textarea>
					<div class="row">
						<span class="hint">
							บรรทัดละ 1 URL · ใส่ IP ต่อท้ายเพื่อปัก DNS ให้ชื่อนั้นชี้ไปเครื่องที่ต้องการ (ใช้เมื่อชื่อเดียวมีหลายเครื่อง)
						</span>
						<span class="spacer"></span>
						{@render groupPicker(zapTarget, (v) => (zapTarget = v), busy(zapStatus))}
					</div>
					{@render parsePreview(
						zapParsed.errors,
						zapParsed.pins.map((p) => ({ name: p.host, ip: p.ip })),
						'ปัก DNS'
					)}
					<HostResolver
						disabled={busy(zapStatus)}
						onpick={(c) => (zapTarget = appendLine(zapTarget, `https://${c.host} ${c.ip}`))}
					/>

					<div class="actions">
						{#if zapStatus === 'running'}
							<span class="pill run">{ZAP_PHASE_LABEL[zapPhase] ?? 'กำลังสแกน...'}{zapProgress ? ` · ${zapProgress}` : ''}</span>
							<button type="button" class="button" disabled={zapCancelling} onclick={cancelZapScan}>
								{zapCancelling ? '⏳ กำลังยกเลิก...' : '⛔ ยกเลิก'}
							</button>
						{/if}
						<span class="spacer"></span>
						<button
							type="button"
							class="button primary big"
							disabled={!zapParsed.urls.length || zapParsed.errors.length > 0 || busy(zapStatus)}
							onclick={startZapScan}
						>
							{busy(zapStatus) ? '⏳ กำลังสแกน...' : '⚡ เริ่มสแกน ZAP'}
						</button>
					</div>
					{#if zapStatus === 'running'}{@render progress(zapPercent)}{/if}
					{@render outcome(zapStatus, zapError, zapResult)}
				</div>
			{:else if activeTab === 'openvas'}
				<div class="tab-body">
					<p class="sub">
						สแกนเครื่องเซิร์ฟเวอร์: พอร์ต บริการ และซอฟต์แวร์ที่มีช่องโหว่ ใส่ได้ทั้ง IP, โดเมน และ CIDR
						ผลนำเข้าระบบอัตโนมัติเมื่อเสร็จ
					</p>
					<label class="field" for="openvas-target">
						IP หรือโดเมน <span class="count">{countTargets(openvasTarget) || ''}</span>
					</label>
					<textarea
						id="openvas-target"
						rows="3"
						bind:value={openvasTarget}
						placeholder={'10.1.2.3\nexample.kku.ac.th'}
						disabled={busy(openvasStatus)}
					></textarea>
					<div class="row">
						<span class="hint">บรรทัดละ 1 รายการ หรือคั่นด้วย comma</span>
						<span class="spacer"></span>
						{@render groupPicker(openvasTarget, (v) => (openvasTarget = v), busy(openvasStatus))}
					</div>

					<div class="actions">
						{#if openvasStatus === 'running'}
							<span class="pill run">กำลังสแกน...</span>
							<button type="button" class="button" disabled={openvasCancelling} onclick={cancelOpenvasScan}>
								{openvasCancelling ? '⏳ กำลังยกเลิก...' : '⛔ ยกเลิก'}
							</button>
						{/if}
						<span class="spacer"></span>
						<button
							type="button"
							class="button primary big"
							disabled={!openvasTarget.trim() || busy(openvasStatus)}
							onclick={startOpenvasScan}
						>
							{busy(openvasStatus) ? '⏳ กำลังสแกน...' : '🛡️ เริ่มสแกน OpenVAS'}
						</button>
					</div>
					{#if openvasStatus === 'running'}{@render progress(openvasPercent)}{/if}
					{@render outcome(openvasStatus, openvasError, openvasResult)}
				</div>
			{:else if activeTab === 'nuclei'}
				<div class="tab-body">
					<p class="sub">
						ตรวจช่องโหว่ที่รู้จักด้วย template ใส่ CVE ID เพื่อตรวจตัวเดียว หรือเว้นว่างเพื่อตรวจทั้งชุด
						ผลนำเข้าระบบอัตโนมัติเมื่อเสร็จ
					</p>
					<label class="field" for="nuclei-target">
						เป้าหมาย
						<span class="count">
							{nucleiParsed.targets.length ? `${nucleiParsed.targets.length} เป้าหมาย` : ''}
							{nucleiPairCount ? ` · ${nucleiPairCount} Host header` : ''}
						</span>
					</label>
					<textarea
						id="nuclei-target"
						rows="4"
						bind:value={nucleiTarget}
						placeholder={'10.1.2.3\n10.101.102.34 web1.kku.ac.th\n10.101.102.35 web2.kku.ac.th'}
						disabled={busy(nucleiStatus)}
					></textarea>
					<div class="row">
						<span class="hint">
							บรรทัดละ 1 เป้าหมาย · ใส่ชื่อเว็บต่อท้าย IP เพื่อยิงที่ IP นั้นด้วย Host header ของชื่อนั้น
						</span>
						<span class="spacer"></span>
						{@render groupPicker(nucleiTarget, (v) => (nucleiTarget = v), busy(nucleiStatus))}
					</div>
					{@render parsePreview(
						nucleiParsed.errors,
						nucleiParsed.groups
							.filter((g) => g.hostHeader)
							.flatMap((g) => g.targets.map((t) => ({ name: g.hostHeader, ip: t }))),
						'Host header'
					)}
					<label class="field" for="nuclei-cve">
						CVE ID (ไม่บังคับ)
						<input
							id="nuclei-cve"
							type="text"
							bind:value={nucleiCveId}
							placeholder="เช่น CVE-2021-44228"
							disabled={busy(nucleiStatus)}
						/>
					</label>
					<HostResolver
						disabled={busy(nucleiStatus)}
						onpick={(c) => (nucleiTarget = appendLine(nucleiTarget, `${c.ip} ${c.host}`))}
					/>
					<details class="adv" bind:open={nucleiAdvancedOpen}>
						<summary>
							Host header สำหรับบรรทัดที่ไม่ได้ระบุชื่อ {nucleiHostHeader ? `· ${nucleiHostHeader}` : '(ไม่บังคับ)'}
						</summary>
						<div class="adv-grid">
							<label class="field" for="nuclei-host">
								ชื่อเว็บ
								<input
									id="nuclei-host"
									type="text"
									bind:value={nucleiHostHeader}
									placeholder="เช่น web.kku.ac.th"
									disabled={busy(nucleiStatus)}
								/>
							</label>
							<p class="hint">
								ใช้กับทุกบรรทัดที่มีแค่ IP เช่นสแกนหลาย IP ด้วยชื่อเว็บเดียวกัน บรรทัดที่มีชื่อของตัวเองจะใช้ชื่อนั้นแทน
							</p>
						</div>
					</details>

					<div class="actions">
						{#if nucleiStatus === 'running'}
							<span class="pill run">กำลังสแกน...</span>
							<button type="button" class="button" disabled={nucleiCancelling} onclick={cancelNucleiScan}>
								{nucleiCancelling ? '⏳ กำลังยกเลิก...' : '⛔ ยกเลิก'}
							</button>
						{/if}
						<span class="spacer"></span>
						<button
							type="button"
							class="button primary big"
							disabled={!nucleiParsed.targets.length || nucleiParsed.errors.length > 0 || busy(nucleiStatus)}
							onclick={startNucleiScan}
						>
							{busy(nucleiStatus) ? '⏳ กำลังสแกน...' : '🎯 เริ่มสแกน Nuclei'}
						</button>
					</div>
					{#if nucleiStatus === 'running'}{@render progress(nucleiPercent)}{/if}
					{@render outcome(nucleiStatus, nucleiError, nucleiResult)}
				</div>
			{:else if activeTab === 'nessus' && NESSUS_SCAN_ENABLED}
				<div class="tab-body">
					<p class="sub">สั่ง Nessus สแกน แล้วดึงผลกลับมานำเข้าอัตโนมัติเมื่อเสร็จ</p>
					<label class="field" for="nessus-target">IP หรือโดเมน</label>
					<textarea id="nessus-target" rows="3" bind:value={nessusTarget} disabled={busy(nessusStatus)}></textarea>
					<div class="row">
						<span class="spacer"></span>
						{@render groupPicker(nessusTarget, (v) => (nessusTarget = v), busy(nessusStatus))}
					</div>
					<div class="actions">
						<span class="spacer"></span>
						<button
							type="button"
							class="button primary big"
							disabled={!nessusTarget.trim() || busy(nessusStatus)}
							onclick={startNessusScan}
						>
							{busy(nessusStatus) ? '⏳ กำลังสแกน...' : '🛰️ เริ่มสแกน Nessus'}
						</button>
					</div>
					{@render outcome(nessusStatus, nessusError, nessusResult)}
				</div>
			{/if}
		</section>

		<!-- ================= Right: live status ================= -->
		<aside class="panel live" aria-label="สถานะการสแกน">
			<div class="panel-head">
				<h2>กำลังทำงาน</h2>
				<span class="hint">{runningJobs.length > 0 ? 'อัปเดตทุก 5 วิ' : ''}</span>
			</div>
			{#if runningJobs.length === 0}
				<p class="empty">ไม่มีงานที่กำลังสแกน</p>
			{:else}
				<ul class="jobs">
					{#each runningJobs as job (job.id)}
						<li class="job">
							<div class="job-top">
								<b>{TOOL_LABEL[job.tool] ?? job.tool}</b>
								<span class="pill run">
									{#if job.liveTargets && job.liveTargets.length > 1}
										{job.liveTargets.filter((x) => x.done).length}/{job.liveTargets.length} เว็บ ·
									{/if}
									{typeof job.livePercent === 'number' ? `${job.livePercent}%` : 'กำลังสแกน'}
								</span>
							</div>
							{@render progress(job.livePercent, true)}
							{#if job.liveTargets && job.liveTargets.length > 1}
								<ul class="sub-targets">
									{#each job.liveTargets as tr (tr.url)}
										<li title={tr.error ?? tr.url}>
											<code>{tr.url.replace(/^https?:\/\//, '')}</code>
											{#if tr.error}
												<span class="pill err">ล้มเหลว</span>
											{:else if tr.done}
												<span class="pill ok">เสร็จ</span>
											{:else}
												<span class="pill run">{TARGET_PHASE_LABEL[tr.phase] ?? tr.phase}</span>
											{/if}
											<span class="num">{tr.percent}%</span>
										</li>
									{/each}
								</ul>
							{:else}
								<div class="job-target">{job.target}</div>
							{/if}
							<div class="job-foot">
								<span class="hint">{job.created_by ?? '—'} · {fmtTime(job.created_at)}</span>
								{#if job.tool !== 'nessus'}
									<button
										type="button"
										class="button ghost"
										disabled={cancellingJobs.has(job.id)}
										onclick={() => cancelHistoryJob(job)}
									>
										{cancellingJobs.has(job.id) ? '⏳' : '⛔ ยกเลิก'}
									</button>
								{/if}
							</div>
						</li>
					{/each}
				</ul>
			{/if}

			<div class="panel-head recent-head">
				<h2>เสร็จล่าสุด</h2>
				<button type="button" class="button ghost" onclick={() => invalidateAll()} title="รีเฟรช">🔄</button>
			</div>
			{#if recentJobs.length === 0}
				<p class="empty">ยังไม่มีประวัติการสั่งสแกน</p>
			{:else}
				<ul class="jobs">
					{#each recentJobs as job (job.id)}
						<li class="job">
							<div class="job-top">
								<span class="job-title">
									<b>{TOOL_LABEL[job.tool] ?? job.tool}</b>
									<span class="job-target inline">{job.target}</span>
								</span>
								<span class="pill" class:ok={job.status === 'done'} class:err={job.status === 'error'}>
									{job.status === 'done' ? 'สำเร็จ' : job.status === 'error' ? 'ล้มเหลว' : job.status}
								</span>
							</div>
							{#if job.status === 'error' && job.error_message}
								<div class="job-error">{job.error_message}</div>
							{/if}
							<div class="job-foot">
								<span class="hint">{fmtTime(job.created_at)}</span>
								{#if job.report_id}
									<a class="button ghost" href="/reports/{job.report_id}">ดูผล →</a>
								{/if}
							</div>
						</li>
					{/each}
				</ul>
			{/if}
			<button type="button" class="button full" onclick={() => (showHistory = !showHistory)}>
				{showHistory ? 'ซ่อนประวัติทั้งหมด' : `ประวัติทั้งหมด (${data.jobs.length}) ↓`}
			</button>
		</aside>
	</div>

	{#if showHistory}
		<section class="panel">
			<div class="panel-head">
				<h2>📋 ประวัติการสั่งสแกน</h2>
				<button type="button" class="button" onclick={() => invalidateAll()}>🔄 รีเฟรช</button>
			</div>
			<div class="table-wrap">
				<table class="jobs-table">
					<thead>
						<tr>
							<th>เครื่องมือ</th>
							<th>Target</th>
							<th>สถานะ</th>
							<th>สั่งโดย</th>
							<th>เมื่อ</th>
							<th></th>
						</tr>
					</thead>
					<tbody>
						{#each data.jobs as job (job.id)}
							<tr>
								<td>{TOOL_LABEL[job.tool] ?? job.tool}{job.extra ? ` (${job.extra})` : ''}</td>
								<td class="mono">
									{job.target}
									{#if job.resolved_targets && job.resolved_targets !== job.target}
										<div class="resolved-targets-note">📋 {job.resolved_targets}</div>
									{/if}
								</td>
								<td>
									<span class="pill" class:ok={job.status === 'done'} class:err={job.status === 'error'} class:run={job.status === 'running'}>
										{STATUS_LABEL[job.status] ?? job.status}
									</span>
									{#if job.status === 'running'}{@render progress(job.livePercent, true)}{/if}
									{#if job.status === 'error' && job.error_message}
										<div class="job-error">{job.error_message}</div>
									{/if}
								</td>
								<td>{job.created_by ?? '—'}</td>
								<td class="mono">{fmtTime(job.created_at)}</td>
								<td>
									{#if job.report_id}
										<a class="button" href="/reports/{job.report_id}">ดูผล</a>
									{/if}
									{#if job.status === 'running' && job.tool !== 'nessus'}
										<button
											type="button"
											class="button"
											disabled={cancellingJobs.has(job.id)}
											onclick={() => cancelHistoryJob(job)}
										>
											{cancellingJobs.has(job.id) ? '⏳' : '⛔'}
										</button>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	{/if}

	<details class="panel groups">
		<summary><h2>📁 จัดการกลุ่ม IP ({ipGroups.length})</h2></summary>
		<p class="sub">
			บันทึกชุด IP/host ที่ใช้บ่อยไว้เป็นกลุ่ม แล้วกด "แทรกกลุ่ม IP" ในฟอร์มด้านบนเพื่อใส่ทั้งชุดได้ทันที
		</p>
		<div class="group-form">
			<input
				type="text"
				bind:value={newGroupName}
				placeholder="ชื่อกลุ่ม เช่น เซิร์ฟเวอร์แผนก IT"
				aria-label="ชื่อกลุ่ม"
				disabled={groupBusy}
			/>
			<textarea
				bind:value={newGroupTargets}
				placeholder="IP/host บรรทัดละ 1 หรือคั่นด้วย comma"
				aria-label="IP/host ในกลุ่ม"
				disabled={groupBusy}
				rows="2"
			></textarea>
			<button
				type="button"
				class="button"
				disabled={groupBusy || !newGroupName.trim() || !newGroupTargets.trim()}
				onclick={createGroup}
			>
				💾 บันทึกกลุ่ม
			</button>
		</div>
		{#if groupError}
			<div class="err-box">{groupError}</div>
		{/if}
		{#if ipGroups.length > 0}
			<div class="table-wrap">
				<table class="groups-table">
					<thead>
						<tr><th>ชื่อกลุ่ม</th><th>Targets</th><th></th></tr>
					</thead>
					<tbody>
						{#each ipGroups as group (group.id)}
							<tr>
								<td>{group.name}</td>
								<td class="mono">{group.targets}</td>
								<td><button type="button" class="button" onclick={() => deleteGroup(group.id)}>🗑️ ลบ</button></td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</details>
</div>

<style>
	.wrap {
		max-width: 1100px;
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
	.page-head {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 1rem;
	}
	h1 {
		font-size: 1.3rem;
		margin: 0;
	}
	h2 {
		font-size: 1rem;
		margin: 0;
	}

	/* Two columns: form | live status. Stacks on narrow screens. */
	.split {
		display: grid;
		grid-template-columns: minmax(0, 1.65fr) minmax(0, 1fr);
		gap: 1.25rem;
		align-items: start;
		margin-bottom: 1.25rem;
	}
	@media (max-width: 860px) {
		.split {
			grid-template-columns: 1fr;
		}
	}

	.panel {
		background: var(--panel-bg, var(--code-bg));
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 1.1rem 1.25rem;
		min-width: 0;
	}
	.panel + .panel,
	section.panel,
	details.panel {
		margin-bottom: 1.25rem;
	}
	.split > .panel {
		margin-bottom: 0;
	}
	.panel-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.6rem;
	}
	.recent-head {
		margin-top: 1.1rem;
		padding-top: 0.9rem;
		border-top: 1px solid var(--border);
	}

	/* Tool tabs */
	.tabs {
		display: flex;
		gap: 0.25rem;
		border-bottom: 1px solid var(--border);
		margin: -0.2rem 0 1rem;
		overflow-x: auto;
	}
	.tabs button {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		background: none;
		border: 0;
		border-bottom: 2px solid transparent;
		color: var(--muted);
		padding: 0.5rem 0.75rem 0.6rem;
		cursor: pointer;
		font: inherit;
		white-space: nowrap;
		position: relative;
	}
	.tabs button:hover:not(:disabled) {
		color: var(--text);
	}
	.tabs button[aria-selected='true'] {
		color: var(--text);
		border-bottom-color: var(--accent);
	}
	.tabs button:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.tab-logo {
		height: 20px;
		width: auto;
		max-width: 60px;
		object-fit: contain;
	}
	.tab-text {
		display: flex;
		flex-direction: column;
		line-height: 1.15;
		text-align: left;
	}
	.tab-text b {
		font-size: 0.88rem;
	}
	.tab-text small {
		font-size: 0.7rem;
		color: var(--muted);
	}
	.dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: #e0b050;
	}

	.tab-body {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.sub {
		color: var(--muted);
		font-size: 0.86rem;
		margin: 0 0 0.25rem;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: 0.8rem;
		color: var(--muted);
		font-weight: 600;
	}
	label.field[for$='-target'] {
		flex-direction: row;
		justify-content: space-between;
	}
	.count {
		font-weight: 400;
		font-variant-numeric: tabular-nums;
	}
	textarea,
	input,
	.inline-select {
		font: inherit;
		font-size: 0.88rem;
		padding: 0.5rem 0.6rem;
		border-radius: 6px;
		border: 1px solid var(--border);
		background: var(--bg);
		color: var(--text);
		min-width: 0;
	}
	textarea {
		resize: vertical;
		font-family: var(--mono, monospace);
		font-size: 0.84rem;
	}
	.row,
	.actions,
	.status {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		flex-wrap: wrap;
	}
	.actions {
		margin-top: 0.4rem;
		padding-top: 0.8rem;
		border-top: 1px solid var(--border);
	}
	.spacer {
		flex: 1;
	}
	.hint {
		font-size: 0.76rem;
		color: var(--muted);
	}

	.parse-errors {
		list-style: none;
		margin: 0;
		padding: 0.5rem 0.75rem;
		border-radius: 6px;
		background: rgba(241, 154, 154, 0.1);
		color: #f19a9a;
		font-size: 0.8rem;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
	.pairs {
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 0.5rem 0.75rem;
		background: var(--bg);
	}
	.pairs-head {
		font-size: 0.76rem;
		font-weight: 600;
		color: var(--muted);
	}
	.pairs ul {
		list-style: none;
		margin: 0.3rem 0 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
		gap: 0.2rem 1rem;
		max-height: 9rem;
		overflow-y: auto;
	}
	.pairs li {
		display: flex;
		gap: 0.4rem;
		align-items: baseline;
		font-size: 0.78rem;
		min-width: 0;
	}
	.pairs code {
		font-family: var(--mono, monospace);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.pairs .arrow {
		color: var(--muted);
	}
	details.adv {
		border: 1px dashed var(--border);
		border-radius: 8px;
		padding: 0.5rem 0.75rem;
	}
	details.adv summary {
		cursor: pointer;
		font-size: 0.84rem;
		color: var(--accent);
		font-weight: 600;
	}
	.adv-grid {
		display: grid;
		grid-template-columns: minmax(180px, 240px) 1fr;
		gap: 0.75rem;
		align-items: end;
		margin-top: 0.6rem;
	}
	@media (max-width: 560px) {
		.adv-grid {
			grid-template-columns: 1fr;
		}
	}
	.adv-grid .hint {
		margin: 0;
	}

	/* Live sidebar */
	.live {
		position: sticky;
		top: 1rem;
	}
	@media (max-width: 860px) {
		.live {
			position: static;
		}
	}
	.empty {
		color: var(--muted);
		font-size: 0.84rem;
		margin: 0.25rem 0 0.5rem;
	}
	.jobs {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.job {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		padding: 0.6rem 0;
		border-bottom: 1px solid var(--border);
	}
	.job:last-child {
		border-bottom: 0;
	}
	.job-top {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.86rem;
	}
	.job-title {
		display: flex;
		gap: 0.4rem;
		align-items: baseline;
		min-width: 0;
	}
	.job-target {
		font-family: var(--mono, monospace);
		font-size: 0.74rem;
		color: var(--muted);
		word-break: break-all;
	}
	.job-target.inline {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		word-break: normal;
	}
	.job-foot {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
	}
	.sub-targets {
		list-style: none;
		margin: 0.15rem 0 0;
		padding: 0 0 0 0.6rem;
		border-left: 2px solid var(--border);
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.sub-targets li {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto 2.6rem;
		gap: 0.4rem;
		align-items: center;
		font-size: 0.72rem;
	}
	.sub-targets code {
		font-family: var(--mono, monospace);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
		color: var(--muted);
	}
	.job-error {
		padding: 0.35rem 0.5rem;
		border-radius: 6px;
		background: rgba(241, 154, 154, 0.1);
		color: #f19a9a;
		font-size: 0.74rem;
		line-height: 1.4;
		word-break: break-word;
	}

	/* Progress + pills */
	.bar {
		height: 8px;
		border-radius: 999px;
		background: var(--bg);
		border: 1px solid var(--border);
		overflow: hidden;
	}
	.bar i {
		display: block;
		height: 100%;
		background: var(--accent);
		transition: width 0.4s ease;
	}
	.bar-sm {
		height: 6px;
	}
	.pill {
		display: inline-flex;
		align-items: center;
		padding: 0.15rem 0.55rem;
		border-radius: 999px;
		background: var(--bg);
		font-size: 0.74rem;
		font-weight: 600;
		white-space: nowrap;
	}
	.pill.ok {
		background: #16321f;
		color: #8be3a6;
	}
	.pill.err {
		background: #3a1a1a;
		color: #f19a9a;
	}
	.pill.run {
		background: rgba(224, 176, 80, 0.15);
		color: #e0b050;
	}
	.err-box {
		padding: 0.6rem 0.9rem;
		border-radius: 6px;
		background: #3a1a1a;
		color: #f19a9a;
		font-size: 0.85rem;
		white-space: pre-wrap;
	}

	/* Buttons */
	.button {
		display: inline-block;
		padding: 0.45rem 0.9rem;
		border-radius: 6px;
		border: 1px solid var(--border);
		background: var(--bg);
		color: var(--text);
		cursor: pointer;
		font: inherit;
		font-size: 0.86rem;
		text-decoration: none;
		white-space: nowrap;
	}
	.button:hover:not(:disabled) {
		border-color: var(--accent);
	}
	.button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.button.primary {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--bg);
		font-weight: 600;
	}
	.button.big {
		padding: 0.6rem 1.2rem;
		font-size: 0.92rem;
	}
	.button.ghost {
		background: none;
		border-color: transparent;
		color: var(--accent);
		padding: 0.2rem 0.3rem;
		font-size: 0.8rem;
	}
	.button.full {
		width: 100%;
		margin-top: 0.75rem;
	}

	/* History + groups tables */
	.table-wrap {
		overflow-x: auto;
	}
	.jobs-table,
	.groups-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.84rem;
	}
	.jobs-table th,
	.jobs-table td,
	.groups-table th,
	.groups-table td {
		text-align: left;
		padding: 0.5rem 0.6rem;
		border-bottom: 1px solid var(--border);
		vertical-align: top;
		overflow-wrap: break-word;
	}
	.jobs-table td .bar {
		max-width: 160px;
		margin-top: 0.35rem;
	}
	.mono {
		font-family: var(--mono, monospace);
		word-break: break-all;
	}
	.resolved-targets-note {
		margin-top: 0.25rem;
		color: var(--muted);
		font-size: 0.76rem;
		word-break: break-word;
	}

	details.groups summary {
		cursor: pointer;
		list-style: none;
	}
	details.groups summary::-webkit-details-marker {
		display: none;
	}
	details.groups summary h2::before {
		content: '▸ ';
		color: var(--muted);
	}
	details.groups[open] summary h2::before {
		content: '▾ ';
	}
	details.groups[open] summary {
		margin-bottom: 0.6rem;
	}
	.group-form {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		align-items: flex-start;
		margin-bottom: 0.75rem;
	}
	.group-form input {
		flex: 0 0 220px;
	}
	.group-form textarea {
		flex: 1;
		min-width: 220px;
	}
</style>
