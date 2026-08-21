<script>
	import { page } from '$app/stores';
	import favicon from '$lib/assets/favicon.svg';
	import logo from '$lib/assets/odt-kku-logo.svg';
	import '../app.css';

	let { children, data } = $props();

	const isStandalonePage = $derived(
		$page.url.pathname.startsWith('/login') || $page.url.pathname.startsWith('/share')
	);
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{#if !isStandalonePage}
	<div class="topbar">
		<div class="topbar-inner">
			<a class="topbar-brand" href="/">
				<img src={logo} alt="ODT KKU" />
			</a>
			{#if data.user}
				<span class="topbar-user mono">
					👤 {data.user.name || data.user.email || data.user.sub}
					<span class="topbar-role">({data.user.role})</span>
				</span>
				<a class="topbar-link" href="/ai-key">🔌 AI ของฉัน</a>
				{#if data.user.role === 'admin'}
					<a class="topbar-link" href="/users">👥 จัดการผู้ใช้</a>
					<a class="topbar-link" href="/settings">⚙️ ตั้งค่า AI Prompt</a>
				{/if}
				<a class="topbar-link" href="/logout">ออกจากระบบ</a>
			{:else}
				<a class="topbar-link" href="/login">🔐 เข้าสู่ระบบด้วย KKU SSO</a>
			{/if}
		</div>
	</div>
{/if}

{@render children()}

<style>
	.topbar {
		background: var(--code-bg);
		border-bottom: 1px solid var(--border);
	}
	.topbar-inner {
		max-width: 1000px;
		margin: 0 auto;
		padding: 0.5rem 1.25rem;
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 1rem;
		font-size: 0.82rem;
	}
	.topbar-brand {
		margin-right: auto;
		display: flex;
		align-items: center;
	}
	.topbar-brand img {
		height: 28px;
		width: auto;
	}
	.topbar-user {
		color: var(--muted);
	}
	.topbar-role {
		opacity: 0.7;
		font-size: 0.9em;
	}
	.topbar-link {
		color: var(--accent);
		text-decoration: none;
		font-weight: 600;
	}
	.topbar-link:hover {
		text-decoration: underline;
	}
</style>
