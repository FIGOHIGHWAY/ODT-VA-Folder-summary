<script>
	import { onMount } from 'svelte';
	import logo from '$lib/assets/odt-kku-logo.svg';
	import { lang, initLang, t } from '$lib/i18n.js';

	let { data } = $props();

	onMount(initLang);

	const startUrl = `/login/start?returnTo=${encodeURIComponent(data.returnTo)}`;
</script>

<svelte:head>
	<title>{t($lang, 'login_title')} · {t($lang, 'home_title')}</title>
</svelte:head>

<div class="login-page">
	<div class="login-card">
		<img class="login-logo" src={logo} alt="ODT KKU" />
		<h1>{t($lang, 'home_title')}</h1>
		<p class="sub">{t($lang, 'login_desc')}</p>

		<a class="button primary sso-button" href={startUrl}>
			{t($lang, 'login_button')}
		</a>

		<p class="note">{t($lang, 'login_redirect_note')} <span class="mono">{data.loginHost}</span></p>
	</div>
</div>

<style>
	.login-page {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1.25rem;
	}

	.login-card {
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: 14px;
		padding: 2.25rem 2rem;
		max-width: 420px;
		width: 100%;
		text-align: center;
		box-shadow: 0 2px 16px rgba(0, 0, 0, 0.04);
	}

	.login-logo {
		width: 96px;
		height: auto;
		margin: 0 auto 1rem;
		display: block;
	}

	.login-card .sub {
		margin: 0 0 1.5rem;
		max-width: none;
	}

	.sso-button {
		display: block;
		width: 100%;
		padding: 0.75rem 1rem;
		font-size: 0.95rem;
		border-radius: 10px;
	}

	.note {
		margin: 1rem 0 0;
		font-size: 0.78rem;
		color: var(--muted);
	}
</style>
