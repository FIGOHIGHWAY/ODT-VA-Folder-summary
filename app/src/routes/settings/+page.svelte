<script>
	import { enhance } from '$app/forms';

	let { data, form } = $props();

	let prompt = $state(data.prompt);
</script>

<svelte:head>
	<title>ตั้งค่า AI Prompt — VA Scan</title>
</svelte:head>

<div class="wrap">
	<a class="back-link" href="/">← กลับหน้าแรก</a>
	<h1>ตั้งค่า Prompt ของ AI สรุปผล</h1>
	<p class="hint">
		Prompt นี้ใช้เป็นคำสั่งกลางให้โมเดล AI (KKU AI Gateway) ตอนสรุปผล finding ของทุก domain —
		แก้ตรงนี้ครั้งเดียวมีผลกับปุ่ม "🤖 สรุปด้วย AI" ทั้งหมด ใช้ <code>{'{{CONTACT_EMAIL}}'}</code>
		แทนอีเมลติดต่อที่ตั้งไว้ใน <code>AI_SUMMARY_CONTACT_EMAIL</code>
	</p>

	{#if form?.success}
		<p class="notice success">
			{form.reset ? 'รีเซ็ต prompt กลับเป็นค่าเริ่มต้นแล้ว' : 'บันทึก prompt แล้ว'}
		</p>
	{/if}
	{#if form?.error}
		<p class="notice error">{form.error}</p>
	{/if}
	{#if data.isDefault}
		<p class="notice">ยังไม่มีการตั้งค่าเอง — แสดง prompt เริ่มต้นของระบบอยู่</p>
	{/if}

	<form method="POST" action="?/save" use:enhance>
		<textarea name="prompt" bind:value={prompt} rows="14" spellcheck="false"></textarea>
		<div class="actions">
			<button type="submit" class="primary">บันทึก</button>
		</div>
	</form>

	<form method="POST" action="?/reset" use:enhance class="reset-form">
		<button type="submit" class="secondary">รีเซ็ตเป็นค่าเริ่มต้น</button>
	</form>

	<details>
		<summary>ดู prompt เริ่มต้นของระบบ</summary>
		<pre>{data.defaultPrompt}</pre>
	</details>
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
	.hint code {
		background: var(--code-bg);
		padding: 0.1rem 0.35rem;
		border-radius: 4px;
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
	textarea {
		width: 100%;
		font-family: var(--mono, monospace);
		font-size: 0.88rem;
		padding: 0.75rem;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--code-bg);
		color: inherit;
		resize: vertical;
	}
	.actions {
		margin-top: 0.75rem;
		display: flex;
		justify-content: flex-end;
	}
	.reset-form {
		margin-top: 0.75rem;
	}
	button {
		font-size: 0.88rem;
		padding: 0.5rem 1rem;
		border-radius: 6px;
		border: 1px solid var(--border);
		cursor: pointer;
	}
	button.primary {
		background: var(--accent);
		color: #fff;
		border-color: var(--accent);
	}
	button.secondary {
		background: transparent;
	}
	details {
		margin-top: 2rem;
	}
	details pre {
		background: var(--code-bg);
		padding: 0.75rem;
		border-radius: 8px;
		white-space: pre-wrap;
		font-size: 0.85rem;
	}
</style>
