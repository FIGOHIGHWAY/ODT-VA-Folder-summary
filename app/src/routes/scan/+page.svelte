<script>
	import { invalidateAll } from '$app/navigation';
	import { lang, t } from '$lib/i18n.js';
	import nessusLogo from '$lib/assets/tools/nessus-logo.png';
	import openvasLogo from '$lib/assets/tools/openvas-logo.svg';
	import nucleiLogo from '$lib/assets/tools/nuclei-logo.png';
	import zapLogo from '$lib/assets/tools/zap-logo.svg';

	let { data } = $props();

	const TOOL_LABEL = { nessus: 'Nessus', openvas: 'OpenVAS', nuclei: 'Nuclei', zap: 'ZAP' };
	const STATUS_LABEL = { running: '⏳ กำลังสแกน', done: '✅ สำเร็จ', error: '❌ ล้มเหลว' };

	let ipGroups = $state(data.ipGroups);
	let newGroupName = $state('');
	let newGroupTargets = $state('');
	let groupError = $state('');
	let groupBusy = $state(false);

	async function createGroup() {
		const name = newGroupName.trim();
		const targets = newGroupTargets.trim();
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

	function applyGroup(groupId, setter) {
		const group = ipGroups.find((g) => g.id === Number(groupId));
		if (group) setter(group.targets);
	}

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
			openvasJobId = body.taskId;
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
		} finally {
			openvasCancelling = false;
		}
	}

	let zapTarget = $state('');
	let zapStatus = $state('idle'); // idle | starting | running | done | error
	let zapPhase = $state('');
	let zapProgress = $state('');
	let zapPercent = $state(null);
	let zapError = $state('');
	let zapResult = $state(null);
	let zapJobId = $state(null);
	let zapCancelling = $state(false);
	let zapPollTimer = null;

	function stopZapPoll() {
		if (zapPollTimer) clearTimeout(zapPollTimer);
		zapPollTimer = null;
	}

	const ZAP_PHASE_LABEL = {
		spider: 'กำลัง crawl หน้าเว็บ (spider)',
		'active-scan': 'กำลังสแกนหาช่องโหว่ (active scan)',
		'fetching-alerts': 'กำลังดึงผลลัพธ์'
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
		const targets = zapTarget.trim();
		if (!targets) return;
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
		} finally {
			zapCancelling = false;
		}
	}

	let nucleiTarget = $state('');
	let nucleiCveId = $state('');
	let nucleiStatus = $state('idle'); // idle | starting | running | done | error
	let nucleiError = $state('');
	let nucleiResult = $state(null);
	let nucleiJobId = $state(null);
	let nucleiCancelling = $state(false);
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
				body: JSON.stringify({ targets, cveId: nucleiCveId.trim() || undefined })
			});
			const body = await res.json();
			if (!res.ok) {
				nucleiStatus = 'error';
				nucleiError = body.error ?? 'สั่งสแกนไม่สำเร็จ';
				return;
			}
			nucleiStatus = 'running';
			nucleiJobId = body.jobId;
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
		} finally {
			nucleiCancelling = false;
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

	<div class="panel">
		<h2>📁 กลุ่ม IP</h2>
		<p class="sub">
			บันทึกชุด IP/host ที่ใช้บ่อยไว้เป็นกลุ่ม แล้วเลือกใส่ในช่อง target ของแต่ละเครื่องมือได้เลย
			โดยไม่ต้องพิมพ์ใหม่ทุกครั้ง — เหมาะกับการสแกนหาช่องโหว่เดียวกันในหลาย IP พร้อมกัน
		</p>
		<div style="display:flex; gap:.5rem; flex-wrap:wrap; align-items:flex-start">
			<input
				type="text"
				bind:value={newGroupName}
				placeholder="ชื่อกลุ่ม เช่น เซิร์ฟเวอร์แผนก IT"
				disabled={groupBusy}
				style="flex:0 0 220px; padding:.5rem; border-radius:6px; border:1px solid var(--border); background:var(--bg); color:var(--text)"
			/>
			<textarea
				bind:value={newGroupTargets}
				placeholder="IP/host คั่นด้วย comma หรือขึ้นบรรทัดใหม่ เช่น 10.1.2.3, 10.1.2.4"
				disabled={groupBusy}
				rows="2"
				style="flex:1; min-width:220px; padding:.5rem; border-radius:6px; border:1px solid var(--border); background:var(--bg); color:var(--text); font-family:inherit"
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
			<table class="jobs-table" style="margin-top:.75rem">
				<thead>
					<tr>
						<th>ชื่อกลุ่ม</th>
						<th>Targets</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#each ipGroups as group (group.id)}
						<tr>
							<td>{group.name}</td>
							<td class="mono">{group.targets}</td>
							<td>
								<button type="button" class="button" onclick={() => deleteGroup(group.id)}>🗑️ ลบ</button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</div>

	{#if NESSUS_SCAN_ENABLED}
		<div class="panel">
			<h2><img src={nessusLogo} alt="Nessus" class="tool-logo" /> สั่งสแกนด้วย Nessus</h2>
			<p class="sub">
				พิมพ์ IP หรือโดเมนของเป้าหมาย (คั่นด้วย comma เพื่อสแกนหลาย host พร้อมกัน เช่น
				10.1.2.3, 10.1.2.4) ระบบจะสั่ง Nessus เริ่มสแกน แล้วดึงผลกลับมา import
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
				{#if ipGroups.length > 0}
					<select
						onchange={(e) => {
							applyGroup(e.target.value, (v) => (nessusTarget = v));
							e.target.value = '';
						}}
						style="padding:.5rem; border-radius:6px; border:1px solid var(--border); background:var(--bg); color:var(--text)"
					>
						<option value="">📁 เลือกกลุ่ม IP...</option>
						{#each ipGroups as group (group.id)}
							<option value={group.id}>{group.name}</option>
						{/each}
					</select>
				{/if}
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
			พิมพ์ IP หรือโดเมนของเป้าหมาย (คั่นด้วย comma เพื่อสแกนหลาย host พร้อมกัน เช่น
			10.1.2.3, 10.1.2.4) ระบบจะสั่ง OpenVAS เริ่มสแกน แล้วดึงผลกลับมา import
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
			{#if ipGroups.length > 0}
				<select
					onchange={(e) => {
						applyGroup(e.target.value, (v) => (openvasTarget = v));
						e.target.value = '';
					}}
					style="padding:.5rem; border-radius:6px; border:1px solid var(--border); background:var(--bg); color:var(--text)"
				>
					<option value="">📁 เลือกกลุ่ม IP...</option>
					{#each ipGroups as group (group.id)}
						<option value={group.id}>{group.name}</option>
					{/each}
				</select>
			{/if}
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
			<div class="status">
				<span class="badge">กำลังสแกน... ระบบจะดึงผลอัตโนมัติเมื่อเสร็จ</span>
				<button type="button" class="button" disabled={openvasCancelling} onclick={cancelOpenvasScan}>
					{openvasCancelling ? '⏳ กำลังยกเลิก...' : '⛔ ยกเลิกสแกน'}
				</button>
			</div>
			{#if openvasPercent !== null}
				<div class="progress-bar">
					<div class="progress-fill" style="width:{openvasPercent}%"></div>
					<span class="progress-label">{openvasPercent}%</span>
				</div>
			{/if}
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
		<h2><img src={zapLogo} alt="ZAP" class="tool-logo" /> สั่งสแกนด้วย OWASP ZAP</h2>
		<p class="sub">
			ใส่ URL เต็มรูปแบบของเว็บเป้าหมาย (เช่น https://example.kku.ac.th) คั่นด้วย comma
			เพื่อสแกนหลาย URL ต่อเนื่องกัน ระบบจะสั่ง ZAP crawl
			หน้าเว็บ (spider) แล้วสแกนหาช่องโหว่ (active scan) ทีละ URL แล้วดึงผลกลับมา import
			เข้าระบบให้อัตโนมัติเมื่อสแกนเสร็จ
		</p>
		<div style="display:flex; gap:.5rem; flex-wrap:wrap; align-items:center">
			<input
				type="text"
				bind:value={zapTarget}
				placeholder="เช่น https://example.kku.ac.th"
				disabled={zapStatus === 'starting' || zapStatus === 'running'}
				style="flex:1; min-width:220px; padding:.5rem; border-radius:6px; border:1px solid var(--border); background:var(--bg); color:var(--text)"
			/>
			{#if ipGroups.length > 0}
				<select
					onchange={(e) => {
						applyGroup(e.target.value, (v) => (zapTarget = v));
						e.target.value = '';
					}}
					style="padding:.5rem; border-radius:6px; border:1px solid var(--border); background:var(--bg); color:var(--text)"
				>
					<option value="">📁 เลือกกลุ่ม IP...</option>
					{#each ipGroups as group (group.id)}
						<option value={group.id}>{group.name}</option>
					{/each}
				</select>
			{/if}
			<button
				type="button"
				class="button"
				disabled={!zapTarget.trim() || zapStatus === 'starting' || zapStatus === 'running'}
				onclick={startZapScan}
			>
				{zapStatus === 'starting' || zapStatus === 'running' ? '⏳ กำลังสแกน...' : '⚡ เริ่มสแกน'}
			</button>
		</div>

		{#if zapStatus === 'running'}
			<div class="status">
				<span class="badge">{ZAP_PHASE_LABEL[zapPhase] ?? 'กำลังสแกน...'}</span>
				{#if zapProgress}
					<span style="color:var(--muted)">({zapProgress})</span>
				{/if}
				<button type="button" class="button" disabled={zapCancelling} onclick={cancelZapScan}>
					{zapCancelling ? '⏳ กำลังยกเลิก...' : '⛔ ยกเลิกสแกน'}
				</button>
			</div>
			{#if zapPercent !== null}
				<div class="progress-bar">
					<div class="progress-fill" style="width:{zapPercent}%"></div>
					<span class="progress-label">{zapPercent}%</span>
				</div>
			{/if}
		{:else if zapStatus === 'error'}
			<div class="status"><span class="badge err">สแกนล้มเหลว</span></div>
			<div class="err-box">{zapError}</div>
		{:else if zapStatus === 'done' && zapResult}
			{#if zapResult.duplicate}
				<div class="status">
					<span class="badge">{t($lang, 'home_already_imported')}</span>
					<a class="button" href="/reports/{zapResult.existingReportId}">
						{t($lang, 'home_view_original')}
					</a>
				</div>
			{:else}
				<div class="status">
					<span class="badge ok">นำเข้าผลสแกนสำเร็จ</span>
					<span style="color:var(--muted)">{zapResult.insertedCount} finding(s)</span>
					<a class="button" href="/reports/{zapResult.reportId}">{t($lang, 'home_view_detail')}</a>
				</div>
			{/if}
		{/if}
	</div>

	<div class="panel">
		<h2><img src={nucleiLogo} alt="Nuclei" class="tool-logo" /> สั่งสแกนด้วย Nuclei</h2>
		<p class="sub">
			พิมพ์ IP หรือโดเมนของเป้าหมาย (คั่นด้วย comma เพื่อสแกนหลาย host พร้อมกัน) ระบบจะสั่ง Nuclei
			เริ่มสแกน แล้วดึงผลกลับมา import เข้าระบบให้อัตโนมัติเมื่อสแกนเสร็จ ใส่ CVE ID (เช่น
			CVE-2021-44228) ถ้าต้องการสแกนหาช่องโหว่เจาะจงตัวเดียว — เว้นว่างไว้เพื่อสแกนด้วยชุด template
			เต็มรูปแบบ
		</p>
		<div style="display:flex; gap:.5rem; flex-wrap:wrap; align-items:center">
			<input
				type="text"
				bind:value={nucleiTarget}
				placeholder="เช่น 10.1.2.3 หรือ https://example.kku.ac.th"
				disabled={nucleiStatus === 'starting' || nucleiStatus === 'running'}
				style="flex:1; min-width:220px; padding:.5rem; border-radius:6px; border:1px solid var(--border); background:var(--bg); color:var(--text)"
			/>
			<input
				type="text"
				bind:value={nucleiCveId}
				placeholder="CVE ID (ไม่บังคับ) เช่น CVE-2021-44228"
				disabled={nucleiStatus === 'starting' || nucleiStatus === 'running'}
				style="flex:0 0 240px; padding:.5rem; border-radius:6px; border:1px solid var(--border); background:var(--bg); color:var(--text)"
			/>
			{#if ipGroups.length > 0}
				<select
					onchange={(e) => {
						applyGroup(e.target.value, (v) => (nucleiTarget = v));
						e.target.value = '';
					}}
					style="padding:.5rem; border-radius:6px; border:1px solid var(--border); background:var(--bg); color:var(--text)"
				>
					<option value="">📁 เลือกกลุ่ม IP...</option>
					{#each ipGroups as group (group.id)}
						<option value={group.id}>{group.name}</option>
					{/each}
				</select>
			{/if}
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
			<div class="status">
				<span class="badge">กำลังสแกน... ระบบจะดึงผลอัตโนมัติเมื่อเสร็จ</span>
				<button type="button" class="button" disabled={nucleiCancelling} onclick={cancelNucleiScan}>
					{nucleiCancelling ? '⏳ กำลังยกเลิก...' : '⛔ ยกเลิกสแกน'}
				</button>
			</div>
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

	<div class="panel">
		<div class="panel-head">
			<h2>📋 สถานะสแกน</h2>
			<button type="button" class="button" onclick={() => invalidateAll()}>🔄 รีเฟรช</button>
		</div>
		{#if data.jobs.length === 0}
			<p class="sub">ยังไม่มีประวัติการสั่งสแกน</p>
		{:else}
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
								<span class="badge" class:ok={job.status === 'done'} class:err={job.status === 'error'}>
									{STATUS_LABEL[job.status] ?? job.status}
								</span>
								{#if job.status === 'error' && job.error_message}
									<div class="job-error">{job.error_message}</div>
								{/if}
							</td>
							<td>{job.created_by ?? '—'}</td>
							<td class="mono">{new Date(job.created_at).toLocaleString('th-TH')}</td>
							<td>
								{#if job.report_id}
									<a class="button" href="/reports/{job.report_id}">ดูผล</a>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
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
	.panel-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.75rem;
	}
	.panel-head h2 {
		margin-bottom: 0;
	}
	.jobs-table {
		width: 100%;
		table-layout: fixed;
		border-collapse: collapse;
		font-size: 0.85rem;
	}
	.jobs-table th,
	.jobs-table td {
		text-align: left;
		padding: 0.5rem 0.6rem;
		border-bottom: 1px solid var(--border);
		vertical-align: top;
		overflow-wrap: break-word;
	}
	.jobs-table th:nth-child(1),
	.jobs-table td:nth-child(1) {
		width: 14%;
	}
	.jobs-table th:nth-child(2),
	.jobs-table td:nth-child(2) {
		width: 22%;
	}
	.jobs-table th:nth-child(3),
	.jobs-table td:nth-child(3) {
		width: 28%;
	}
	.jobs-table th:nth-child(4),
	.jobs-table td:nth-child(4) {
		width: 16%;
	}
	.jobs-table th:nth-child(5),
	.jobs-table td:nth-child(5) {
		width: 12%;
	}
	.jobs-table th:nth-child(6),
	.jobs-table td:nth-child(6) {
		width: 8%;
	}
	.mono {
		font-family: var(--mono, monospace);
		word-break: break-all;
	}
	.job-error {
		margin-top: 0.35rem;
		padding: 0.4rem 0.5rem;
		border-radius: 6px;
		background: rgba(241, 154, 154, 0.1);
		color: #f19a9a;
		font-size: 0.76rem;
		line-height: 1.4;
		word-break: break-word;
	}
	.resolved-targets-note {
		margin-top: 0.25rem;
		color: var(--muted);
		font-size: 0.76rem;
		word-break: break-word;
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
	.progress-bar {
		position: relative;
		margin-top: 0.6rem;
		height: 1.4rem;
		border-radius: 999px;
		background: var(--code-bg);
		border: 1px solid var(--border);
		overflow: hidden;
	}
	.progress-fill {
		height: 100%;
		background: var(--accent);
		transition: width 0.4s ease;
	}
	.progress-label {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--text);
		mix-blend-mode: difference;
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
