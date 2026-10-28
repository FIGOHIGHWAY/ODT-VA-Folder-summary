<script>
	import { invalidateAll } from '$app/navigation';

	let { data } = $props();

	let ip = $state('');
	let hostname = $state('');
	let label = $state('');
	let note = $state('');
	let busy = $state(false);
	let errorText = $state('');

	/** editing an existing row prefills the form and the save upserts by IP */
	function editRow(h) {
		ip = h.ip;
		hostname = h.hostname ?? '';
		label = h.label;
		note = h.note ?? '';
		errorText = '';
		window.scrollTo({ top: 0, behavior: 'smooth' });
	}

	function resetForm() {
		ip = '';
		hostname = '';
		label = '';
		note = '';
		errorText = '';
	}

	async function save(e) {
		e.preventDefault();
		busy = true;
		errorText = '';
		try {
			const res = await fetch('/api/hosts', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ ip, hostname, label, note })
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) {
				errorText = body.error ?? 'บันทึกไม่สำเร็จ';
				return;
			}
			resetForm();
			await invalidateAll();
		} finally {
			busy = false;
		}
	}

	async function remove(h) {
		if (!confirm(`ลบ ${h.ip} (${h.label}) ออกจากทะเบียน?`)) return;
		busy = true;
		try {
			const res = await fetch(`/api/hosts/${h.id}`, { method: 'DELETE' });
			if (res.ok) await invalidateAll();
		} finally {
			busy = false;
		}
	}

	/** group rows by hostname so shared names read as "one name, several servers" */
	const grouped = $derived.by(() => {
		const map = new Map();
		for (const h of data.hosts) {
			const key = h.hostname || '(ไม่ระบุ hostname)';
			if (!map.has(key)) map.set(key, []);
			map.get(key).push(h);
		}
		return [...map.entries()];
	});
</script>

<svelte:head>
	<title>ทะเบียน Host · VA Scan</title>
</svelte:head>

<div class="wrap">
	<p class="eyebrow"><a href="/">← กลับหน้าแรก</a></p>
	<h1>🖧 ทะเบียน Host / IP</h1>
	<p class="sub">
		ระบุว่าแต่ละ IP คือเครื่อง/เว็บอะไร เมื่อ hostname เดียวชี้ไปหลายเครื่อง (คนละเว็บ) ระบบจะเอา
		label นี้ไปกำกับที่ finding ให้แยกออกว่ามาจากเครื่องไหน
	</p>

	<div class="panel">
		<h2 class="ph">เพิ่ม / แก้ไขเครื่อง</h2>
		<form class="host-form" onsubmit={save}>
			<label>
				<span>IP (IPv4) *</span>
				<input class="mono" bind:value={ip} placeholder="10.1.1.10" required />
			</label>
			<label>
				<span>Hostname (ถ้ามี)</span>
				<input class="mono" bind:value={hostname} placeholder="web.kku.ac.th" />
			</label>
			<label class="wide">
				<span>ชื่อ/คำอธิบายเครื่อง (label) *</span>
				<input bind:value={label} placeholder="เช่น ระบบ Creator — node A" required />
			</label>
			<label class="wide">
				<span>หมายเหตุ</span>
				<input bind:value={note} placeholder="เจ้าของระบบ / ฝ่ายที่ดูแล ฯลฯ" />
			</label>
			<div class="form-actions">
				<button type="submit" class="button" disabled={busy}>บันทึก</button>
				<button type="button" class="button" disabled={busy} onclick={resetForm}>ล้างฟอร์ม</button>
				{#if errorText}<span class="err-text">{errorText}</span>{/if}
			</div>
			<p class="hint">บันทึก IP เดิมซ้ำ = อัปเดตข้อมูลเครื่องนั้น</p>
		</form>
	</div>

	<div class="panel">
		<h2 class="ph">รายการทั้งหมด ({data.hosts.length})</h2>
		{#if data.hosts.length === 0}
			<div class="empty">ยังไม่มีรายการ</div>
		{:else}
			{#each grouped as [name, rows] (name)}
				<div class="group">
					<div class="group-head">
						<span class="mono">{name}</span>
						{#if rows.length > 1}<span class="multi">{rows.length} เครื่องใช้ชื่อนี้</span>{/if}
					</div>
					<div class="scroll">
						<table>
							<thead>
								<tr><th>IP</th><th>Label</th><th>หมายเหตุ</th><th></th></tr>
							</thead>
							<tbody>
								{#each rows as h (h.id)}
									<tr>
										<td class="mono">{h.ip}</td>
										<td>{h.label}</td>
										<td class="muted">{h.note ?? '—'}</td>
										<td class="row-actions">
											<button type="button" class="button" onclick={() => editRow(h)}>แก้ไข</button>
											<button type="button" class="button button-danger" onclick={() => remove(h)}>ลบ</button>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</div>
			{/each}
		{/if}
	</div>
</div>

<style>
	.ph {
		font-size: 1rem;
		margin: 0 0 0.9rem;
	}
	.host-form {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
	}
	.host-form label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.82rem;
	}
	.host-form label.wide {
		grid-column: 1 / -1;
	}
	.host-form input {
		padding: 0.45rem 0.6rem;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--bg);
		color: var(--text);
		font: inherit;
	}
	.form-actions {
		grid-column: 1 / -1;
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}
	.hint {
		grid-column: 1 / -1;
		margin: 0;
		font-size: 0.78rem;
		color: var(--muted);
	}
	.err-text {
		color: #dc2626;
		font-size: 0.85rem;
	}
	.group {
		margin-bottom: 1.25rem;
	}
	.group-head {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
		margin-bottom: 0.4rem;
		font-weight: 600;
	}
	.multi {
		font-size: 0.72rem;
		font-weight: 600;
		color: #b45309;
		background: rgba(217, 119, 6, 0.12);
		border-radius: 999px;
		padding: 0.05rem 0.5rem;
	}
	.muted {
		color: var(--muted);
	}
	.row-actions {
		display: flex;
		gap: 0.4rem;
		white-space: nowrap;
	}
	@media (max-width: 560px) {
		.host-form {
			grid-template-columns: 1fr;
		}
	}
</style>
