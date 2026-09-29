<script>
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import favicon from '$lib/assets/favicon.svg';
	import logo from '$lib/assets/odt-kku-logo.svg';
	import { lang, initLang, setLang, t } from '$lib/i18n.js';
	import '../app.css';

	let { children, data } = $props();

	const isStandalonePage = $derived(
		$page.url.pathname.startsWith('/login') || $page.url.pathname.startsWith('/share')
	);

	const THEME_STORAGE_KEY = 'va-scan-theme';
	let theme = $state('auto'); // auto | light | dark

	onMount(() => {
		initLang();
		document.documentElement.lang = localStorage.getItem('va-scan-lang') || 'th';

		const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
		if (storedTheme === 'light' || storedTheme === 'dark') {
			theme = storedTheme;
			document.documentElement.dataset.theme = storedTheme;
		}
	});

	function toggleTheme() {
		const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
		const currentlyDark = theme === 'dark' || (theme === 'auto' && prefersDark);
		const next = currentlyDark ? 'light' : 'dark';
		theme = next;
		document.documentElement.dataset.theme = next;
		localStorage.setItem(THEME_STORAGE_KEY, next);
	}

	function toggleLang() {
		setLang($lang === 'th' ? 'en' : 'th');
	}
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
			{#if $page.url.pathname !== '/'}
				<a class="topbar-link" href="/">{t($lang, 'nav_home')}</a>
			{/if}
			{#if data.user}
				<span class="topbar-user mono">
					👤 {data.user.name || data.user.email || data.user.sub}
					<span class="topbar-role">({data.user.role})</span>
				</span>
				<a class="topbar-link" href="/ai-key">{t($lang, 'nav_ai_key')}</a>
				{#if data.user.role === 'admin' || data.user.role === 'soc'}
					<a class="topbar-link" href="/scan">{t($lang, 'nav_scan')}</a>
				{/if}
				{#if data.user.role === 'admin'}
					<details class="topbar-menu">
						<summary>⚙️ จัดการระบบ</summary>
						<div class="topbar-menu-panel">
							<a class="topbar-menu-item" href="/users">{t($lang, 'nav_users')}</a>
							<a class="topbar-menu-item" href="/settings">{t($lang, 'nav_settings')}</a>
							<a class="topbar-menu-item" href="/links">{t($lang, 'nav_links')}</a>
						</div>
					</details>
				{/if}
				<a class="topbar-link" href="/logout">{t($lang, 'nav_logout')}</a>
			{:else}
				<a class="topbar-link" href="/login">{t($lang, 'nav_login')}</a>
			{/if}
			<button type="button" class="icon-btn" onclick={toggleTheme} title={t($lang, 'theme_toggle')}>
				🌓
			</button>
			<button type="button" class="lang-btn" onclick={toggleLang}>
				{$lang === 'th' ? 'EN' : 'ไทย'}
			</button>
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
		max-width: 1100px;
		margin: 0 auto;
		padding: 0.6rem 1.25rem;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: flex-end;
		gap: 0.4rem 1rem;
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
		white-space: nowrap;
	}
	.topbar-role {
		opacity: 0.7;
		font-size: 0.9em;
	}
	.topbar-link {
		color: var(--accent);
		text-decoration: none;
		font-weight: 600;
		white-space: nowrap;
	}
	.topbar-link:hover {
		text-decoration: underline;
	}
	.topbar-menu {
		position: relative;
	}
	.topbar-menu summary {
		list-style: none;
		color: var(--accent);
		font-weight: 600;
		cursor: pointer;
		white-space: nowrap;
		padding: 0.15rem 0.3rem;
		border-radius: 6px;
	}
	.topbar-menu summary::-webkit-details-marker {
		display: none;
	}
	.topbar-menu[open] summary,
	.topbar-menu summary:hover {
		background: var(--bg);
	}
	.topbar-menu-panel {
		position: absolute;
		top: calc(100% + 0.4rem);
		right: 0;
		background: var(--code-bg);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 0.35rem;
		display: flex;
		flex-direction: column;
		min-width: 160px;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
		z-index: 20;
	}
	.topbar-menu-item {
		color: var(--text);
		text-decoration: none;
		font-weight: 500;
		font-size: 0.85rem;
		padding: 0.45rem 0.6rem;
		border-radius: 6px;
		white-space: nowrap;
	}
	.topbar-menu-item:hover {
		background: var(--bg);
		color: var(--accent);
	}
	.icon-btn {
		background: none;
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 0.2rem 0.5rem;
		cursor: pointer;
		font-size: 0.95rem;
		line-height: 1.2;
	}
	.icon-btn:hover {
		border-color: var(--accent);
	}
	.lang-btn {
		background: none;
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 0.2rem 0.6rem;
		cursor: pointer;
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--text);
	}
	.lang-btn:hover {
		border-color: var(--accent);
		color: var(--accent);
	}
</style>
