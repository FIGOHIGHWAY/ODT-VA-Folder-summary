<script>
	import { enhance } from '$app/forms';

	let { data, form } = $props();
</script>

<svelte:head>
	<title>เชื่อมต่อ AI ของฉัน — VA Scan</title>
</svelte:head>

<div class="wrap">
	<a class="back-link" href="/">← กลับหน้าแรก</a>
	<h1>เชื่อมต่อ AI ของฉัน</h1>
	<p class="hint">
		ปุ่ม "🤖 สรุปด้วย AI" ใช้ API key ของคุณเอง — ไม่มีคีย์กลางของระบบ ผู้ใช้แต่ละคนต้องเชื่อมต่อ AI
		Gateway ของตัวเอง (เช่น KKU AI Gateway) ก่อนถึงจะใช้ฟีเจอร์สรุปได้ ถ้ายังไม่เชื่อมต่อ ปุ่มสรุปจะไม่แสดง
	</p>

	{#if form?.error}
		<p class="notice error">{form.error}</p>
	{/if}
	{#if form?.success && !form.disconnected}
		<p class="notice success">บันทึกการเชื่อมต่อแล้ว</p>
	{/if}
	{#if form?.success && form.disconnected}
		<p class="notice success">ยกเลิกการเชื่อมต่อแล้ว</p>
	{/if}

	<div class="panel">
		<p class="status-line">
			สถานะ:
			{#if data.connected}
				<span class="status-badge connected">✅ เชื่อมต่อแล้ว</span>
				{#if data.updatedAt}
					<span class="muted">(อัปเดตล่าสุด {new Date(data.updatedAt).toLocaleString('th-TH')})</span>
				{/if}
			{:else}
				<span class="status-badge">◯ ยังไม่เชื่อมต่อ</span>
			{/if}
		</p>

		<form method="POST" action="?/save" use:enhance class="key-form">
			<label>
				API key
				<input type="password" name="apiKey" placeholder="sk-..." required autocomplete="off" />
			</label>
			<label>
				Base URL (ไม่บังคับ — ค่าเริ่มต้น {data.defaultBaseUrl})
				<input type="text" name="baseUrl" placeholder={data.defaultBaseUrl} />
			</label>
			<label>
				Model (ไม่บังคับ — ค่าเริ่มต้น {data.defaultModel})
				<input type="text" name="model" placeholder={data.defaultModel} />
			</label>
			<button type="submit" class="primary">{data.connected ? 'บันทึกใหม่' : 'เชื่อมต่อ'}</button>
		</form>

		{#if data.connected}
			<form method="POST" action="?/disconnect" use:enhance class="disconnect-form">
				<button type="submit" class="danger">ยกเลิกการเชื่อมต่อ</button>
			</form>
		{/if}
	</div>
</div>

<style>
	.wrap {
		max-width: 640px;
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
	.notice {
		padding: 0.6rem 0.9rem;
		border-radius: 6px;
		background: var(--code-bg);
		font-size: 0.88rem;
		margin-bottom: 1rem;
	}
	.notice.success {
		background: #16321f;
		color: #8be3a6;
	}
	.notice.error {
		background: #3a1a1a;
		color: #f19a9a;
	}
	.status-line {
		margin: 0 0 1.25rem;
		font-size: 0.9rem;
	}
	.status-badge {
		display: inline-block;
		padding: 0.15rem 0.6rem;
		border-radius: 999px;
		background: var(--code-bg);
		font-size: 0.82rem;
		margin-left: 0.4rem;
	}
	.status-badge.connected {
		background: #16321f;
		color: #8be3a6;
	}
	.muted {
		color: var(--muted);
		font-size: 0.82rem;
	}
	.key-form {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}
	.key-form label {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: 0.82rem;
		color: var(--muted);
	}
	input {
		padding: 0.5rem 0.65rem;
		border-radius: 6px;
		border: 1px solid var(--border);
		background: var(--code-bg);
		color: inherit;
		font-size: 0.88rem;
	}
	button {
		font-size: 0.88rem;
		padding: 0.5rem 1rem;
		border-radius: 6px;
		border: 1px solid var(--border);
		cursor: pointer;
		align-self: flex-start;
	}
	button.primary {
		background: var(--accent);
		color: #fff;
		border-color: var(--accent);
	}
	.disconnect-form {
		margin-top: 1rem;
	}
	button.danger {
		background: transparent;
		color: #e07a7a;
		border-color: #e07a7a;
	}
</style>
