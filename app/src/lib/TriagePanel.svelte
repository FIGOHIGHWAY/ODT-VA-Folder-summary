<script>
	import { TRIAGE_LABEL, needsReviewReason } from '$lib/triage.js';

	/**
	 * @type {{
	 *   finding: object,
	 *   canTriage?: boolean,
	 *   onchange?: (update: { domain: string, titleKey: string, triage: object }) => void
	 * }}
	 */
	let { finding: f, canTriage = false, onchange } = $props();

	const OPTIONS = ['confirmed', 'false_positive', 'accepted_risk'];

	/** status chosen but not yet saved (FP / accepted risk need a reason first) */
	let pending = $state(null);
	let reason = $state('');
	let busy = $state(false);
	let errorText = $state('');

	const reviewReason = $derived(needsReviewReason(f));

	async function send(method, body) {
		busy = true;
		errorText = '';
		try {
			const res = await fetch('/api/triage', {
				method,
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ domain: f.triage_domain, titleKey: f.title_key, ...body })
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				errorText = data.error ?? 'บันทึกไม่สำเร็จ';
				return;
			}
			pending = null;
			reason = '';
			onchange?.(data);
		} finally {
			busy = false;
		}
	}

	function choose(status) {
		if (status === 'confirmed') {
			send('POST', { status });
			return;
		}
		pending = status;
		reason = '';
	}
</script>

<div class="triage-panel">
	<div class="triage-head">
		<strong>ผลตรวจสอบ:</strong>
		{#if f.triage_status}
			<span class="current {f.triage_status}">{TRIAGE_LABEL[f.triage_status]}</span>
			<span class="who">
				โดย {f.triage_by ?? '—'}
				{#if f.triage_at}· {new Date(f.triage_at).toLocaleString('th-TH')}{/if}
			</span>
		{:else}
			<span class="current none">ยังไม่ตรวจ</span>
		{/if}
	</div>

	{#if f.triage_reason}
		<div class="reason-text">เหตุผล: {f.triage_reason}</div>
	{/if}
	{#if reviewReason}
		<div class="review-hint">⚠ ควรตรวจซ้ำ: {reviewReason}</div>
	{/if}

	{#if canTriage}
		<div class="triage-actions">
			{#each OPTIONS as status}
				<button
					type="button"
					class="button opt {status}"
					class:active={f.triage_status === status || pending === status}
					disabled={busy}
					onclick={() => choose(status)}>{TRIAGE_LABEL[status]}</button
				>
			{/each}
			{#if f.triage_status}
				<button type="button" class="button" disabled={busy} onclick={() => send('DELETE', {})}>
					ล้างผล
				</button>
			{/if}
		</div>

		{#if pending}
			<form
				class="reason-form"
				onsubmit={(e) => {
					e.preventDefault();
					send('POST', { status: pending, reason });
				}}
			>
				<input
					type="text"
					bind:value={reason}
					placeholder={pending === 'false_positive'
						? 'เหตุผล เช่น ทดสอบ payload ซ้ำแล้วไม่ทำงาน / OS backport แพตช์แล้ว'
						: 'เหตุผล เช่น ระบบปิดใช้งานภายใน 3 เดือน / มี WAF ป้องกัน'}
					required
				/>
				<button type="submit" class="button" disabled={busy || !reason.trim()}>บันทึก</button>
				<button type="button" class="button" disabled={busy} onclick={() => (pending = null)}>ยกเลิก</button>
			</form>
		{/if}

		<div class="scope-note">
			ผลนี้ใช้กับ "{f.title}" ทุกรายการของ <span class="mono">{f.triage_domain}</span> รวมถึงรอบสแกนถัดไป
		</div>
		{#if errorText}<div class="err-text">{errorText}</div>{/if}
	{/if}
</div>

<style>
	.triage-panel {
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 0.75rem 0.9rem;
		margin-bottom: 1rem;
		font-size: 0.85rem;
	}
	.triage-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}
	.current {
		font-weight: 600;
	}
	.current.confirmed {
		color: #dc2626;
	}
	.current.false_positive,
	.current.none {
		color: var(--muted);
	}
	.current.accepted_risk {
		color: #2563eb;
	}
	.who,
	.scope-note {
		color: var(--muted);
		font-size: 0.75rem;
	}
	.reason-text {
		margin-top: 0.35rem;
	}
	.review-hint {
		margin-top: 0.35rem;
		color: #b45309;
	}
	.triage-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin: 0.6rem 0 0.4rem;
	}
	.opt.active {
		border-color: var(--accent);
		background: var(--accent);
		color: #fff;
	}
	.reason-form {
		display: flex;
		gap: 0.4rem;
		margin-bottom: 0.4rem;
	}
	.reason-form input {
		flex: 1;
		min-width: 0;
	}
	.err-text {
		color: #dc2626;
		margin-top: 0.35rem;
	}
</style>
