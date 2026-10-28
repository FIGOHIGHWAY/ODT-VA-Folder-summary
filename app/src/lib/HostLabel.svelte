<script>
	import { resolveHostInfo } from '$lib/hostRegistry.js';

	/** @type {{ finding: object, index: { byIp: Map, byHostname: Map } | null }} */
	let { finding: f, index } = $props();

	const info = $derived(index ? resolveHostInfo(f.affected_url_or_port || f.target, index) : null);
</script>

{#if info?.kind === 'exact'}
	<span class="host-label" title={`${info.entry.ip}${info.entry.hostname ? ' · ' + info.entry.hostname : ''}${info.entry.note ? ' · ' + info.entry.note : ''}`}>
		🖥 {info.entry.label}
	</span>
{:else if info?.kind === 'candidates'}
	<span
		class="host-label multi"
		title={info.entries.map((e) => `${e.ip} = ${e.label}`).join('\n')}
	>
		🖥 {info.entries.length} เครื่องใช้ชื่อนี้: {info.entries.map((e) => e.label).join(', ')}
	</span>
{/if}

<style>
	.host-label {
		display: inline-block;
		margin-left: 0.4rem;
		padding: 0.05rem 0.45rem;
		border-radius: 999px;
		font-size: 0.7rem;
		font-weight: 600;
		white-space: nowrap;
		vertical-align: middle;
		background: rgba(37, 99, 235, 0.1);
		color: #2563eb;
		border: 1px solid rgba(37, 99, 235, 0.3);
	}
	.host-label.multi {
		background: rgba(217, 119, 6, 0.12);
		color: #b45309;
		border-color: rgba(217, 119, 6, 0.35);
		white-space: normal;
	}
</style>
