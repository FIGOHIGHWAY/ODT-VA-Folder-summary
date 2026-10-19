<script>
	import { TRIAGE_LABEL, needsReviewReason } from '$lib/triage.js';

	/** @type {{ finding: object }} */
	let { finding: f } = $props();

	const reviewReason = $derived(needsReviewReason(f));
</script>

{#if f.triage_status}
	<span class="triage-badge {f.triage_status}" title={f.triage_reason ?? ''}>
		{TRIAGE_LABEL[f.triage_status]}
	</span>
{:else if reviewReason}
	<span class="triage-badge review" title={reviewReason}>⚠ ควรตรวจซ้ำ</span>
{/if}

<style>
	.triage-badge {
		display: inline-block;
		margin-left: 0.4rem;
		padding: 0.05rem 0.45rem;
		border-radius: 999px;
		font-size: 0.7rem;
		font-weight: 600;
		white-space: nowrap;
		vertical-align: middle;
		border: 1px solid transparent;
	}
	.confirmed {
		background: rgba(220, 38, 38, 0.12);
		color: #dc2626;
		border-color: rgba(220, 38, 38, 0.35);
	}
	.false_positive {
		background: var(--code-bg);
		color: var(--muted);
		border-color: var(--border);
		text-decoration: line-through;
	}
	.accepted_risk {
		background: rgba(37, 99, 235, 0.1);
		color: #2563eb;
		border-color: rgba(37, 99, 235, 0.3);
	}
	.review {
		background: rgba(217, 119, 6, 0.12);
		color: #b45309;
		border-color: rgba(217, 119, 6, 0.35);
	}
</style>
