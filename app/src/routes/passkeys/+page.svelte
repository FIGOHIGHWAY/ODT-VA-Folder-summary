<script>
	import { invalidateAll } from '$app/navigation';

	let { data } = $props();

	let busy = $state(false);
	let error = $state('');
	let deviceName = $state('');
	/** @type {string[]|null} */
	let newRecoveryCodes = $state(null);

	function fmt(d) {
		return d ? new Date(d).toLocaleString('th-TH') : '—';
	}

	async function addPasskey() {
		busy = true;
		error = '';
		try {
			const { startRegistration } = await import('@simplewebauthn/browser');
			const optRes = await fetch('/api/mfa/register/options', { method: 'POST' });
			if (!optRes.ok) throw new Error((await optRes.json()).error ?? 'ขอ options ไม่สำเร็จ');
			const options = await optRes.json();

			let attResp;
			try {
				attResp = await startRegistration({ optionsJSON: options });
			} catch (err) {
				throw new Error('เบราว์เซอร์ยกเลิกหรือไม่รองรับ passkey: ' + (err instanceof Error ? err.message : err));
			}

			const verRes = await fetch('/api/mfa/register/verify', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ response: attResp, deviceName: deviceName.trim() || null })
			});
			const body = await verRes.json();
			if (!verRes.ok || !body.verified) throw new Error(body.error ?? 'เพิ่ม passkey ไม่สำเร็จ');
			deviceName = '';
			await invalidateAll();
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			busy = false;
		}
	}

	async function rename(id, current) {
		const name = prompt('ตั้งชื่ออุปกรณ์ใหม่', current ?? '');
		if (name == null) return;
		await fetch(`/api/mfa/credentials/${encodeURIComponent(id)}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name })
		});
		await invalidateAll();
	}

	async function remove(id) {
		if (data.credentials.length === 1) {
			if (!confirm('นี่คือ passkey ตัวสุดท้าย — ถ้าลบ ครั้งต่อไปที่เข้าระบบจะต้องลงทะเบียน passkey ใหม่ ดำเนินการต่อ?'))
				return;
		} else if (!confirm('ลบ passkey นี้?')) {
			return;
		}
		await fetch(`/api/mfa/credentials/${encodeURIComponent(id)}`, { method: 'DELETE' });
		await invalidateAll();
	}

	async function regenerate() {
		if (!confirm('สร้าง recovery codes ชุดใหม่? ชุดเดิมทั้งหมดจะใช้ไม่ได้อีก')) return;
		busy = true;
		error = '';
		try {
			const res = await fetch('/api/mfa/recovery/regenerate', { method: 'POST' });
			const body = await res.json();
			if (!res.ok) throw new Error(body.error ?? 'สร้างใหม่ไม่สำเร็จ');
			newRecoveryCodes = body.recoveryCodes;
			await invalidateAll();
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			busy = false;
		}
	}

	function copyCodes() {
		if (newRecoveryCodes) navigator.clipboard?.writeText(newRecoveryCodes.join('\n'));
	}
</script>

<svelte:head>
	<title>Passkey & MFA — VA Scan</title>
</svelte:head>

<div class="wrap">
	<a class="back-link" href="/">← กลับหน้าแรก</a>
	<h1>🔐 Passkey & การยืนยันสองขั้น</h1>
	<p class="hint">
		จัดการ passkey ที่ใช้เข้าระบบ และ recovery codes สำรอง — ระบบนี้บังคับยืนยันตัวตนสองขั้นสำหรับทุกบัญชี
	</p>

	<div class="panel">
		<div class="panel-head">
			<h2>Passkey ของคุณ ({data.credentials.length})</h2>
		</div>
		{#if data.credentials.length === 0}
			<p class="sub">ยังไม่มี passkey</p>
		{:else}
			<table>
				<thead>
					<tr>
						<th>อุปกรณ์</th>
						<th>ชนิด</th>
						<th>สร้างเมื่อ</th>
						<th>ใช้ล่าสุด</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#each data.credentials as c (c.id)}
						<tr>
							<td>{c.deviceName || '(ไม่ตั้งชื่อ)'}</td>
							<td>{c.backedUp ? '☁️ ซิงก์หลายอุปกรณ์' : '🔒 อุปกรณ์เดียว'}</td>
							<td class="mono">{fmt(c.createdAt)}</td>
							<td class="mono">{fmt(c.lastUsedAt)}</td>
							<td class="actions">
								<button class="button" type="button" onclick={() => rename(c.id, c.deviceName)}>เปลี่ยนชื่อ</button>
								<button class="button danger" type="button" onclick={() => remove(c.id)}>ลบ</button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}

		<div class="add-row">
			<input type="text" bind:value={deviceName} placeholder="ชื่ออุปกรณ์ (ไม่บังคับ)" disabled={busy} />
			<button class="button primary" type="button" onclick={addPasskey} disabled={busy}>
				{busy ? '⏳ กำลังเพิ่ม...' : '➕ เพิ่ม passkey'}
			</button>
		</div>
	</div>

	<div class="panel">
		<div class="panel-head">
			<h2>Recovery codes</h2>
		</div>
		<p class="sub">
			เหลือใช้ได้ <strong>{data.recoveryRemaining}</strong> รหัส —
			ใช้เข้าระบบแทน passkey ได้เมื่อ passkey หาย (แต่ละรหัสใช้ครั้งเดียว)
		</p>
		{#if newRecoveryCodes}
			<ul class="codes">
				{#each newRecoveryCodes as code}
					<li class="mono">{code}</li>
				{/each}
			</ul>
			<p class="warn">⚠️ แสดงครั้งเดียว — คัดลอกเก็บไว้ให้ปลอดภัย</p>
			<button class="button" type="button" onclick={copyCodes}>📋 คัดลอกทั้งหมด</button>
		{:else}
			<button class="button" type="button" onclick={regenerate} disabled={busy}>
				🔄 สร้าง recovery codes ชุดใหม่
			</button>
		{/if}
	</div>

	{#if error}
		<div class="err">{error}</div>
	{/if}
</div>

<style>
	.wrap {
		max-width: 760px;
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
	.panel-head h2 {
		font-size: 1.05rem;
		margin-bottom: 0.75rem;
	}
	.sub {
		color: var(--muted);
		font-size: 0.88rem;
		margin-bottom: 0.9rem;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.85rem;
	}
	th,
	td {
		text-align: left;
		padding: 0.5rem 0.6rem;
		border-bottom: 1px solid var(--border);
		vertical-align: middle;
	}
	.actions {
		display: flex;
		gap: 0.4rem;
		justify-content: flex-end;
	}
	.mono {
		font-family: var(--mono, monospace);
	}
	.add-row {
		display: flex;
		gap: 0.5rem;
		margin-top: 1rem;
		flex-wrap: wrap;
	}
	.add-row input {
		flex: 1;
		min-width: 200px;
		padding: 0.5rem;
		border-radius: 6px;
		border: 1px solid var(--border);
		background: var(--bg);
		color: var(--text);
	}
	.codes {
		list-style: none;
		padding: 0.75rem;
		margin: 0 0 0.6rem;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 8px;
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.3rem 1rem;
	}
	.codes li {
		font-size: 0.95rem;
		letter-spacing: 0.04em;
	}
	.warn {
		color: #e0b050;
		font-size: 0.82rem;
		margin-bottom: 0.6rem;
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
		color: #fff;
		border-color: var(--accent);
	}
	.button.danger:hover:not(:disabled) {
		border-color: #f19a9a;
		color: #f19a9a;
	}
	.err {
		margin-top: 0.5rem;
		padding: 0.6rem 0.9rem;
		border-radius: 6px;
		background: #3a1a1a;
		color: #f19a9a;
		font-size: 0.85rem;
		white-space: pre-wrap;
	}
</style>
