<script>
	import { enhance } from '$app/forms';

	let { data, form } = $props();

	const ROLES = ['admin', 'soc', 'user'];
	const ROLE_LABEL = {
		admin: 'admin — ทำได้ทุกอย่าง',
		soc: 'soc — ฝากไฟล์ / ดึงไฟล์ / ทำรายงานผล',
		user: 'user — ดูไฟล์ / ดึงไฟล์'
	};
</script>

<svelte:head>
	<title>จัดการผู้ใช้ — VA Scan</title>
</svelte:head>

<div class="wrap">
	<a class="back-link" href="/">← กลับหน้าแรก</a>
	<h1>จัดการผู้ใช้ที่เข้าระบบได้</h1>
	<p class="hint">
		รายชื่ออีเมลที่อนุญาตให้ล็อกอินผ่าน KKU SSO เข้าใช้ระบบนี้ได้ (นอกเหนือจากที่ตั้งไว้ใน
		<code>ALLOWED_EMAILS</code> ของ .env ซึ่งลบผ่านหน้านี้ไม่ได้ — กันไม่ให้ล็อกตัวเองออกจากระบบ)
	</p>

	{#if form?.error}
		<p class="notice error">{form.error}</p>
	{/if}
	{#if form?.success && !form.removed}
		<p class="notice success">เพิ่มผู้ใช้แล้ว</p>
	{/if}
	{#if form?.success && form.removed}
		<p class="notice success">ลบผู้ใช้แล้ว</p>
	{/if}

	<form method="POST" action="?/add" use:enhance class="add-form">
		<input type="email" name="email" placeholder="email@kku.ac.th" required />
		<input type="text" name="note" placeholder="หมายเหตุ (ไม่บังคับ)" />
		<select name="role">
			{#each ROLES as r}
				<option value={r}>{ROLE_LABEL[r]}</option>
			{/each}
		</select>
		<button type="submit" class="primary">เพิ่ม</button>
	</form>

	<table>
		<thead>
			<tr>
				<th>อีเมล</th>
				<th>สิทธิ์</th>
				<th>หมายเหตุ</th>
				<th>เพิ่มโดย</th>
				<th>เมื่อ</th>
				<th></th>
			</tr>
		</thead>
		<tbody>
			{#each data.users as user (user.email)}
				<tr>
					<td class="mono">{user.email}</td>
					<td>
						<form method="POST" action="?/setRole" use:enhance class="role-form">
							<input type="hidden" name="email" value={user.email} />
							<select name="role" value={user.role} onchange={(e) => e.target.form.requestSubmit()}>
								{#each ROLES as r}
									<option value={r}>{r}</option>
								{/each}
							</select>
						</form>
					</td>
					<td>{user.note ?? '—'}</td>
					<td>{user.added_by ?? '—'}</td>
					<td>{new Date(user.added_at).toLocaleString('th-TH')}</td>
					<td>
						<form method="POST" action="?/remove" use:enhance>
							<input type="hidden" name="email" value={user.email} />
							<button type="submit" class="danger">ลบ</button>
						</form>
					</td>
				</tr>
			{:else}
				<tr>
					<td colspan="6" class="empty">ยังไม่มีผู้ใช้ที่เพิ่มผ่านหน้านี้</td>
				</tr>
			{/each}
		</tbody>
	</table>
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
	.add-form {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1.5rem;
		flex-wrap: wrap;
	}
	.add-form input[type='email'] {
		flex: 1 1 220px;
	}
	.add-form input[type='text'] {
		flex: 1 1 200px;
	}
	input,
	select {
		padding: 0.5rem 0.65rem;
		border-radius: 6px;
		border: 1px solid var(--border);
		background: var(--code-bg);
		color: inherit;
		font-size: 0.88rem;
	}
	.role-form select {
		padding: 0.3rem 0.5rem;
		font-size: 0.82rem;
	}
	button {
		font-size: 0.85rem;
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
	button.danger {
		background: transparent;
		color: #e07a7a;
		border-color: #e07a7a;
		padding: 0.3rem 0.7rem;
		font-size: 0.8rem;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.88rem;
	}
	th,
	td {
		text-align: left;
		padding: 0.5rem 0.6rem;
		border-bottom: 1px solid var(--border);
	}
	.mono {
		font-family: var(--mono, monospace);
	}
	.empty {
		color: var(--muted);
		text-align: center;
		padding: 1.5rem 0;
	}
</style>
