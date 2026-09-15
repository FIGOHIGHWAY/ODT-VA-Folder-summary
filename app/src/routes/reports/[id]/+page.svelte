<script>
	import { goto } from '$app/navigation';
	import FindingDetail from '$lib/FindingDetail.svelte';

	let { data } = $props();

	/** @type {Set<number>} finding ids currently expanded to show full detail */
	let expanded = $state(new Set());

	function toggle(id) {
		const next = new Set(expanded);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		expanded = next;
	}

	let deleteBusy = $state(false);

	async function deleteThisReport() {
		if (
			!confirm(
				`ลบ report #${data.reportId} ทิ้งถาวร? ข้อมูล finding และไฟล์ต้นฉบับ (ถ้ามี) จะหายไปเลย กู้คืนไม่ได้`
			)
		) {
			return;
		}
		deleteBusy = true;
		try {
			const res = await fetch(`/api/reports/${data.reportId}`, { method: 'DELETE' });
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				alert(body.error ?? 'ลบไม่สำเร็จ');
				return;
			}
			goto('/');
		} finally {
			deleteBusy = false;
		}
	}
</script>

<svelte:head>
	<title>Report #{data.reportId} · Scan Report Normalizer</title>
</svelte:head>

<div class="wrap">
	<p class="eyebrow"><a href="/">← กลับหน้าแรก</a></p>
	<div style="display:flex; justify-content:space-between; align-items:flex-start; gap:1rem">
		<div>
			<h1>Report #{data.reportId}</h1>
			<p class="sub">{data.findings.length} finding(s) — คลิกแถวเพื่อดูรายละเอียดแบบเต็ม</p>
		</div>
		<div style="display:flex; gap:.5rem">
			<a class="button" href="/api/export/report/{data.reportId}">⬇️ ดึงไฟล์ (PDF)</a>
			{#if data.hasOriginal}
				<a class="button" href="/api/reports/{data.reportId}/preview" target="_blank" rel="noopener">
					👁️ ดูตัวอย่าง
				</a>
				<a class="button" href="/api/reports/{data.reportId}/original">⬇️ ไฟล์ต้นฉบับ</a>
			{/if}
			{#if data.canDelete}
				<button type="button" class="button button-danger" disabled={deleteBusy} onclick={deleteThisReport}>
					🗑️ ลบ report นี้
				</button>
			{/if}
		</div>
	</div>

	<div class="panel">
		{#if data.findings.length === 0}
			<div class="empty">ไม่พบ finding ใน report นี้</div>
		{:else}
			<div class="scroll">
				<table>
					<thead>
						<tr>
							<th></th>
							<th>Severity</th>
							<th>Identifier</th>
							<th>Title</th>
							<th>Target / URL</th>
							<th>CVSS</th>
							<th>CVE</th>
						</tr>
					</thead>
					<tbody>
						{#each data.findings as f (f.id)}
							{@const isOpen = expanded.has(f.id)}
							<tr class="finding-row" onclick={() => toggle(f.id)} aria-expanded={isOpen}>
								<td class="caret-cell">
									<span class="caret" class:open={isOpen}>▸</span>
								</td>
								<td><span class="sev {f.severity}">{f.severity}</span></td>
								<td class="mono">{f.identifier}</td>
								<td>{f.title}</td>
								<td class="mono" style="max-width:220px;word-break:break-word">
									{f.affected_url_or_port ?? f.target ?? ''}
								</td>
								<td class="mono" style="font-variant-numeric:tabular-nums">
									{f.cvss_score ?? '—'}
								</td>
								<td class="mono">{f.cve ?? '—'}</td>
							</tr>
							{#if isOpen}
								<tr class="detail-row">
									<td colspan="7">
										<FindingDetail finding={f} />
									</td>
								</tr>
							{/if}
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>
</div>

<style>
	.finding-row {
		cursor: pointer;
	}
	.finding-row:hover td {
		background: rgba(37, 99, 235, 0.06);
	}
	.caret-cell {
		width: 1.5rem;
	}
	.caret {
		display: inline-block;
		color: var(--muted);
		font-size: 0.8em;
		transition: transform 0.15s;
	}
	.caret.open {
		transform: rotate(90deg);
	}
	.detail-row td {
		background: var(--code-bg);
		padding: 1rem 1.25rem;
	}
</style>
