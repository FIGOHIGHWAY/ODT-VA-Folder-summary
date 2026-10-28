<script>
	/**
	 * Type a hostname, resolve it (live DNS + host registry), and pick which
	 * server to scan. onpick receives { ip, host } so the caller fills the
	 * target and the Host header.
	 * @type {{ disabled?: boolean, onpick: (c: { ip: string, host: string }) => void }}
	 */
	let { disabled = false, onpick } = $props();

	let name = $state('');
	let loading = $state(false);
	let error = $state('');
	/** @type {Array<{ ip: string, label: string|null, inDns: boolean, inRegistry: boolean }>} */
	let choices = $state([]);
	let resolvedHost = $state('');

	async function lookup() {
		const host = name.trim().toLowerCase();
		if (!host) return;
		loading = true;
		error = '';
		choices = [];
		try {
			const res = await fetch(`/api/resolve?host=${encodeURIComponent(host)}`);
			const body = await res.json().catch(() => ({}));
			if (!res.ok) {
				error = body.error ?? 'ค้นหาไม่สำเร็จ';
				return;
			}
			resolvedHost = body.host;
			choices = body.choices ?? [];
			if (choices.length === 0) error = `ไม่พบ IP ของ ${body.host} (ทั้งใน DNS และทะเบียน)`;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	function pick(c) {
		onpick({ ip: c.ip, host: resolvedHost });
	}
</script>

<div class="resolver">
	<input
		type="text"
		bind:value={name}
		{disabled}
		placeholder="พิมพ์ชื่อเว็บเพื่อค้นหา IP เช่น kkuenterprise.kku.ac.th"
		onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), lookup())}
	/>
	<button type="button" class="button" disabled={disabled || loading || !name.trim()} onclick={lookup}>
		{loading ? '⏳' : '🔍 หา IP'}
	</button>
</div>

{#if error}
	<div class="resolver-msg err">{error}</div>
{/if}

{#if choices.length > 0}
	<div class="resolver-msg">เลือกเครื่องที่จะสแกน ({resolvedHost}) — ระบบจะเติม IP และ Host header ให้:</div>
	<div class="choices">
		{#each choices as c (c.ip)}
			<button type="button" class="choice" {disabled} onclick={() => pick(c)}>
				<span class="mono">{c.ip}</span>
				{#if c.label}<span class="lbl">{c.label}</span>{/if}
				<span class="src">
					{#if c.inDns}<span class="tag dns">DNS</span>{/if}
					{#if c.inRegistry}<span class="tag reg">ทะเบียน</span>{/if}
					{#if !c.inDns && c.inRegistry}<span class="tag extra">ไม่อยู่ใน DNS</span>{/if}
				</span>
			</button>
		{/each}
	</div>
{/if}

<style>
	.resolver {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.6rem;
	}
	.resolver input {
		flex: 1;
		min-width: 180px;
		padding: 0.5rem;
		border-radius: 6px;
		border: 1px solid var(--border);
		background: var(--bg);
		color: var(--text);
	}
	.resolver-msg {
		font-size: 0.8rem;
		color: var(--muted);
		margin-top: 0.4rem;
	}
	.resolver-msg.err {
		color: #dc2626;
	}
	.choices {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-top: 0.4rem;
	}
	.choice {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.35rem 0.6rem;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--bg);
		color: var(--text);
		cursor: pointer;
		font: inherit;
		font-size: 0.82rem;
	}
	.choice:hover:not(:disabled) {
		border-color: var(--accent);
	}
	.lbl {
		color: var(--text);
	}
	.tag {
		font-size: 0.65rem;
		font-weight: 600;
		border-radius: 999px;
		padding: 0.02rem 0.4rem;
	}
	.tag.dns {
		background: rgba(37, 99, 235, 0.12);
		color: #2563eb;
	}
	.tag.reg {
		background: rgba(22, 163, 74, 0.12);
		color: #16a34a;
	}
	.tag.extra {
		background: rgba(217, 119, 6, 0.14);
		color: #b45309;
	}
</style>
