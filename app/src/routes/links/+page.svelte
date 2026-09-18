<script>
	import { enhance } from '$app/forms';

	let { data, form } = $props();

	function toAbsolute(token) {
		return typeof window !== 'undefined'
			? `${window.location.origin}/share/${token}`
			: `/share/${token}`;
	}

	let copiedToken = $state(null);

	async function copyLink(token) {
		await navigator.clipboard.writeText(toAbsolute(token));
		copiedToken = token;
		setTimeout(() => {
			if (copiedToken === token) copiedToken = null;
		}, 1500);
	}
</script>

<svelte:head>
	<title>จัดการลิงก์แชร์ — VA Scan</title>
</svelte:head>

<div class="wrap">
	<a class="back-link" href="/">← กลับหน้าแรก</a>
	<h1>จัดการลิงก์แชร์</h1>
	<p class="hint">
		รวมลิงก์แชร์ที่เปิดใช้งานอยู่ทั้งหมดในระบบไว้ที่เดียว — ไม่ต้องเข้าไปดูทีละ domain
		ยกเลิกลิงก์ไหนก็ได้จากตรงนี้เลย
	</p>

	{#if form?.error}
		<p class="notice error">{form.error}</p>
	{/if}
	{#if form?.success}
		<p class="notice success">ยกเลิกลิงก์แล้ว</p>
	{/if}

	<table>
		<thead>
			<tr>
				<th>Domain</th>
				<th>รอบ</th>
				<th>ลิงก์</th>
				<th>สร้างโดย</th>
				<th>เมื่อ</th>
				<th></th>
			</tr>
		</thead>
		<tbody>
			{#each data.links as link (link.token)}
				<tr>
					<td class="mono">
						<a href="/folder/{link.domain}">{link.domain}</a>
					</td>
					<td>
						{#if link.round_date}
							<span class="mono">{new Date(link.round_date).toLocaleDateString('sv-SE')}</span>
						{:else}
							<span class="badge">ทุกรอบ</span>
						{/if}
					</td>
					<td>
						<div class="link-cell">
							<a href="/share/{link.token}" target="_blank" rel="noopener" class="mono link-text">
								/share/{link.token}
							</a>
							<button type="button" class="icon-btn" onclick={() => copyLink(link.token)}>
								{copiedToken === link.token ? '✅' : '🔗'}
							</button>
						</div>
					</td>
					<td>{link.created_by ?? '—'}</td>
					<td class="mono">{new Date(link.created_at).toLocaleString('th-TH')}</td>
					<td>
						<form method="POST" action="?/revoke" use:enhance>
							<input type="hidden" name="token" value={link.token} />
							<button type="submit" class="danger">ยกเลิก</button>
						</form>
					</td>
				</tr>
			{:else}
				<tr>
					<td colspan="6" class="empty">ยังไม่มีลิงก์แชร์ที่เปิดใช้งานอยู่</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<style>
	.wrap {
		max-width: 980px;
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
	.mono {
		font-family: var(--mono, monospace);
	}
	.badge {
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		background: var(--code-bg);
		font-size: 0.75rem;
		color: var(--muted);
	}
	.link-cell {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	.link-text {
		color: var(--text);
		text-decoration: none;
		max-width: 220px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.link-text:hover {
		color: var(--accent);
		text-decoration: underline;
	}
	.icon-btn {
		flex: 0 0 auto;
		background: none;
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 0.15rem 0.4rem;
		cursor: pointer;
		font-size: 0.8rem;
	}
	.icon-btn:hover {
		border-color: var(--accent);
	}
	button.danger {
		background: transparent;
		color: #e07a7a;
		border: 1px solid #e07a7a;
		border-radius: 6px;
		padding: 0.3rem 0.7rem;
		font-size: 0.8rem;
		cursor: pointer;
	}
	.empty {
		color: var(--muted);
		text-align: center;
		padding: 1.5rem 0;
	}
</style>
