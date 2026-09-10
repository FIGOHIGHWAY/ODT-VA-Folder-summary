<script>
	/** @type {{ finding: object, showReportLink?: boolean }} */
	let { finding: f, showReportLink = true } = $props();

	function stripTags(html) {
		return html ? html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';
	}
</script>

<div class="detail-grid">
	<div class="detail-field">
		<div class="detail-label">Source tool</div>
		<div class="detail-value">
			<span class="badge {f.source_tool}">{f.source_tool.toUpperCase()}</span>
		</div>
	</div>
	<div class="detail-field">
		<div class="detail-label">Identifier</div>
		<div class="detail-value mono">{f.identifier ?? '—'}</div>
	</div>
	<div class="detail-field">
		<div class="detail-label">CVE</div>
		<div class="detail-value mono">{f.cve ?? '—'}</div>
	</div>
	<div class="detail-field">
		<div class="detail-label">CVSS score</div>
		<div class="detail-value mono">{f.cvss_score ?? '—'}</div>
	</div>
	<div class="detail-field">
		<div class="detail-label">Confidence</div>
		<div class="detail-value">{f.confidence ?? '—'}</div>
	</div>
	<div class="detail-field">
		<div class="detail-label">Target</div>
		<div class="detail-value mono">{f.target ?? '—'}</div>
	</div>
	<div class="detail-field">
		<div class="detail-label">Affected URL / port</div>
		<div class="detail-value mono">{f.affected_url_or_port ?? '—'}</div>
	</div>
	{#if f.report_id && showReportLink}
		<div class="detail-field">
			<div class="detail-label">Report</div>
			<div class="detail-value">
				<a class="button" href="/reports/{f.report_id}">#{f.report_id} →</a>
			</div>
		</div>
	{/if}

	<div class="detail-field full">
		<div class="detail-label">Description</div>
		<div class="detail-value">{f.description || '—'}</div>
	</div>
	<div class="detail-field full">
		<div class="detail-label">Solution</div>
		<div class="detail-value">{f.solution || '—'}</div>
	</div>

	{#if f.raw_evidence}
		<div class="detail-field full">
			<details class="evidence">
				<summary>หลักฐานดิบจากเครื่องมือสแกน (raw evidence)</summary>
				<pre class="evidence-body">{stripTags(f.raw_evidence)}</pre>
			</details>
		</div>
	{/if}
</div>

<style>
	.detail-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 0.9rem;
	}
	.detail-field.full {
		grid-column: 1 / -1;
	}
	.detail-label {
		font-size: 0.72rem;
		color: var(--muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-bottom: 0.25rem;
	}
	.detail-value {
		font-size: 0.88rem;
		white-space: pre-wrap;
		word-break: break-word;
		line-height: 1.5;
	}
	.evidence summary {
		cursor: pointer;
		font-size: 0.78rem;
		color: var(--accent);
		font-weight: 600;
	}
	.evidence-body {
		margin: 0.6rem 0 0;
		padding: 0.75rem;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: 6px;
		font-size: 0.78rem;
		white-space: pre-wrap;
		word-break: break-word;
		max-height: 320px;
		overflow-y: auto;
	}
</style>
