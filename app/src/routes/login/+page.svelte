<script>
	import logo from '$lib/assets/odt-kku-logo.svg';

	let { data } = $props();

	const startUrl = `/login/start?returnTo=${encodeURIComponent(data.returnTo)}`;
</script>

<svelte:head>
	<title>เข้าสู่ระบบ · Scan Report Normalizer</title>
</svelte:head>

<div class="login-page">
	<div class="login-card">
		<img class="login-logo" src={logo} alt="ODT KKU" />
		<p class="eyebrow">nessus · zap → unified json → postgres</p>
		<h1>Scan Report Normalizer</h1>
		<p class="sub">
			ระบบนี้ต้องเข้าสู่ระบบด้วยบัญชี KKU ก่อนใช้งาน กด "เข้าสู่ระบบด้วย KKU SSO"
			เพื่อไปยังหน้ายืนยันตัวตนของมหาวิทยาลัยขอนแก่น
		</p>

		<a class="button primary sso-button" href={startUrl}>
			🔐 เข้าสู่ระบบด้วย KKU SSO
		</a>

		<p class="note">คุณจะถูกนำไปยัง <span class="mono">authorization-req.kku.ac.th</span></p>
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
