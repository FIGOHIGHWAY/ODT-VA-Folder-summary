<script>
	let { data } = $props();

	let busy = $state(false);
	let error = $state('');
	let deviceName = $state('');
	/** @type {string[]|null} recovery codes shown once after first enrollment */
	let recoveryCodes = $state(null);
	let showRecoveryInput = $state(false);
	let recoveryCode = $state('');

	function go() {
		window.location.href = data.returnTo || '/';
	}

	async function enroll() {
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
			if (!verRes.ok || !body.verified) throw new Error(body.error ?? 'ยืนยัน passkey ไม่สำเร็จ');

			if (body.recoveryCodes) {
				recoveryCodes = body.recoveryCodes; // show once, then continue
			} else {
				go();
			}
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			busy = false;
		}
	}

	async function verify() {
		busy = true;
		error = '';
		try {
			const { startAuthentication } = await import('@simplewebauthn/browser');
			const optRes = await fetch('/api/mfa/authenticate/options', { method: 'POST' });
			if (!optRes.ok) throw new Error((await optRes.json()).error ?? 'ขอ options ไม่สำเร็จ');
			const options = await optRes.json();

			let authResp;
			try {
				authResp = await startAuthentication({ optionsJSON: options });
			} catch (err) {
				throw new Error('เบราว์เซอร์ยกเลิกหรือไม่รองรับ passkey: ' + (err instanceof Error ? err.message : err));
			}

			const verRes = await fetch('/api/mfa/authenticate/verify', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ response: authResp })
			});
			const body = await verRes.json();
			if (!verRes.ok || !body.verified) throw new Error(body.error ?? 'ยืนยัน passkey ไม่สำเร็จ');
			go();
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			busy = false;
		}
	}

	async function useRecovery() {
		busy = true;
		error = '';
		try {
			const res = await fetch('/api/mfa/recovery', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ code: recoveryCode.trim() })
			});
			const body = await res.json();
			if (!res.ok || !body.verified) throw new Error(body.error ?? 'recovery code ไม่ถูกต้อง');
			go();
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			busy = false;
		}
	}

	function copyCodes() {
		if (recoveryCodes) navigator.clipboard?.writeText(recoveryCodes.join('\n'));
	}
</script>

<svelte:head>
	<title>ยืนยันตัวตน (MFA) — VA Scan</title>
</svelte:head>

<div class="wrap">
	<div class="card">
		{#if recoveryCodes}
			<h1>🔑 เก็บ recovery codes ของคุณ</h1>
			<p class="sub">
				ลงทะเบียน passkey สำเร็จแล้ว นี่คือรหัสสำรองสำหรับใช้เข้าระบบเมื่อ passkey หาย
				<strong>จะแสดงเพียงครั้งเดียว</strong> — เก็บไว้ในที่ปลอดภัย แต่ละรหัสใช้ได้ครั้งเดียว
			</p>
			<ul class="codes">
				{#each recoveryCodes as code}
					<li class="mono">{code}</li>
				{/each}
			</ul>
			<div class="row">
				<button class="button" type="button" onclick={copyCodes}>📋 คัดลอกทั้งหมด</button>
				<button class="button primary" type="button" onclick={go}>บันทึกแล้ว ไปต่อ →</button>
			</div>
		{:else if data.mfaStatus === 'pending_enroll'}
			<h1>🔐 ตั้งค่า passkey</h1>
			<p class="sub">
				ระบบนี้ต้องยืนยันตัวตนสองขั้น เข้าสู่ระบบด้วย KKU SSO แล้ว ({data.email}) —
				ขั้นต่อไปสร้าง passkey (ลายนิ้วมือ / Face ID / PIN ของอุปกรณ์ หรือ security key)
				เพื่อใช้ยืนยันทุกครั้งที่เข้าระบบ
			</p>
			<label class="field">
				ชื่ออุปกรณ์ (ไม่บังคับ)
				<input type="text" bind:value={deviceName} placeholder="เช่น MacBook ที่ทำงาน" disabled={busy} />
			</label>
			<button class="button primary" type="button" onclick={enroll} disabled={busy}>
				{busy ? '⏳ กำลังสร้าง...' : '➕ สร้าง passkey'}
			</button>
		{:else}
			<h1>🔐 ยืนยันด้วย passkey</h1>
			<p class="sub">
				เข้าสู่ระบบด้วย KKU SSO แล้ว ({data.email}) — ยืนยันตัวตนขั้นที่สองด้วย passkey ของคุณ
			</p>
			<button class="button primary" type="button" onclick={verify} disabled={busy}>
				{busy ? '⏳ กำลังยืนยัน...' : '🔑 ยืนยันด้วย passkey'}
			</button>

			<div class="divider"></div>
			{#if showRecoveryInput}
				<label class="field">
					Recovery code
					<input
						type="text"
						bind:value={recoveryCode}
						placeholder="เช่น k7m2-9qx4-ab3n"
						disabled={busy}
						autocomplete="one-time-code"
					/>
				</label>
				<button class="button" type="button" onclick={useRecovery} disabled={busy || !recoveryCode.trim()}>
					ใช้ recovery code เข้าระบบ
				</button>
			{:else}
				<button class="link" type="button" onclick={() => (showRecoveryInput = true)}>
					ใช้ passkey ไม่ได้? ใช้ recovery code แทน
				</button>
			{/if}
		{/if}

		{#if error}
			<div class="err">{error}</div>
		{/if}

		<p class="logout"><a href="/logout">ออกจากระบบ</a></p>
	</div>
</div>

<style>
	.wrap {
		min-height: 80vh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1.5rem;
	}
	.card {
		width: 100%;
		max-width: 460px;
		background: var(--panel-bg, var(--code-bg));
		border: 1px solid var(--border);
		border-radius: 12px;
		padding: 1.75rem;
	}
	h1 {
		font-size: 1.25rem;
		margin-bottom: 0.6rem;
	}
	.sub {
		color: var(--muted);
		font-size: 0.9rem;
		line-height: 1.6;
		margin-bottom: 1.1rem;
	}
	.field {
		display: block;
		font-size: 0.85rem;
		color: var(--muted);
		margin-bottom: 1rem;
	}
	.field input {
		display: block;
		width: 100%;
		margin-top: 0.35rem;
		padding: 0.55rem;
		border-radius: 6px;
		border: 1px solid var(--border);
		background: var(--bg);
		color: var(--text);
		font-size: 0.95rem;
	}
	.button {
		display: inline-block;
		padding: 0.6rem 1.1rem;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--bg);
		color: var(--text);
		cursor: pointer;
		font-size: 0.92rem;
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
		width: 100%;
	}
	.row {
		display: flex;
		gap: 0.6rem;
		flex-wrap: wrap;
		align-items: center;
	}
	.row .button.primary {
		width: auto;
		flex: 1;
	}
	.codes {
		list-style: none;
		padding: 0.75rem;
		margin: 0 0 1rem;
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
	.mono {
		font-family: var(--mono, monospace);
	}
	.divider {
		height: 1px;
		background: var(--border);
		margin: 1.1rem 0;
	}
	.link {
		background: none;
		border: none;
		color: var(--accent);
		cursor: pointer;
		font-size: 0.85rem;
		padding: 0;
		text-decoration: underline;
	}
	.err {
		margin-top: 1rem;
		padding: 0.6rem 0.9rem;
		border-radius: 6px;
		background: #3a1a1a;
		color: #f19a9a;
		font-size: 0.85rem;
		white-space: pre-wrap;
	}
	.logout {
		margin-top: 1.25rem;
		font-size: 0.82rem;
	}
	.logout a {
		color: var(--muted);
	}
</style>
