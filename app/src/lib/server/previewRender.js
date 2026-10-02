import { parseNucleiJsonl } from './parsers/nuclei.js';
import { parseZapAlerts } from './parsers/zapAlerts.js';
import { parseOpenvasXml } from './parsers/openvas.js';

/**
 * Live-scan imports (Nuclei/ZAP/OpenVAS) store their raw machine output —
 * JSONL, JSON or GMP XML — not an HTML report, so previewing it verbatim
 * shows an unreadable wall of text. These render it as a readable page.
 * Uploaded HTML reports (nessus/zap/burp exports) are already readable and
 * aren't handled here.
 */
const PARSERS = {
	nuclei: (raw, label) => parseNucleiJsonl(raw, label),
	zap: (raw, label) => parseZapAlerts(JSON.parse(raw), label),
	openvas: (raw, label) => parseOpenvasXml(raw, label)
};

/** @param {string} sourceTool @param {string} raw */
export function isRawScanOutput(sourceTool, raw) {
	if (!(sourceTool in PARSERS)) return false;
	// A ZAP report can also be an uploaded HTML export; only live-scan JSON needs rendering.
	return !/^\s*</.test(raw) || sourceTool === 'openvas';
}

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

// Scan output is attacker-influenced (it records the payloads sent and the
// responses received), so every value must be escaped before going into HTML.
function esc(value) {
	return String(value ?? '').replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
	);
}

/** @param {string} raw */
function prettyEvidence(raw) {
	try {
		return JSON.stringify(JSON.parse(raw), null, 2);
	} catch {
		return raw;
	}
}

/**
 * @param {{ sourceTool: string, filename: string, raw: string }} params
 * @returns {string} a self-contained HTML page
 */
export function renderScanPreview({ sourceTool, filename, raw }) {
	const findings = PARSERS[sourceTool](raw, filename).sort(
		(a, b) => (SEVERITY_ORDER[a.severity] ?? 5) - (SEVERITY_ORDER[b.severity] ?? 5)
	);

	const counts = {};
	for (const f of findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
	const countChips = Object.keys(SEVERITY_ORDER)
		.filter((s) => counts[s])
		.map((s) => `<span class="sev ${s}">${s} ${counts[s]}</span>`)
		.join(' ');

	const cards = findings
		.map(
			(f, i) => `
<section class="card">
  <div class="head">
    <span class="sev ${esc(f.severity)}">${esc(f.severity)}</span>
    <h2>${i + 1}. ${esc(f.title)}</h2>
  </div>
  <dl>
    <dt>Target</dt><dd class="mono">${esc(f.affected_url_or_port || f.target)}</dd>
    <dt>Identifier</dt><dd class="mono">${esc(f.identifier)}</dd>
    ${f.cve ? `<dt>CVE</dt><dd class="mono">${esc(f.cve)}</dd>` : ''}
    ${f.cvss_score != null ? `<dt>CVSS</dt><dd>${esc(f.cvss_score)}</dd>` : ''}
  </dl>
  ${f.description ? `<h3>คำอธิบาย</h3><p>${esc(f.description)}</p>` : ''}
  ${f.solution ? `<h3>แนวทางแก้ไข</h3><p>${esc(f.solution)}</p>` : ''}
  <details><summary>ข้อมูลดิบ (request / response)</summary><pre>${esc(prettyEvidence(f.raw_evidence))}</pre></details>
</section>`
		)
		.join('');

	return `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(filename)}</title>
<style>
  :root { color-scheme: light dark; --bg:#f5f6f8; --panel:#fff; --ink:#1b2230; --muted:#5f6b7d; --line:#e1e5eb; --code:#f0f2f5; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0f1514; --panel:#161e1d; --ink:#e6ecea; --muted:#93a19d; --line:#26302e; --code:#0b100f; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font-family:"Segoe UI","Sarabun","Noto Sans Thai",system-ui,sans-serif; line-height:1.55; }
  .wrap { max-width:960px; margin:0 auto; padding:24px 16px 48px; }
  header h1 { margin:0 0 4px; font-size:20px; }
  header p { margin:0 0 16px; color:var(--muted); font-size:14px; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:16px 18px; margin:12px 0; }
  .head { display:flex; align-items:center; gap:10px; }
  .head h2 { margin:0; font-size:16px; }
  dl { display:grid; grid-template-columns:max-content 1fr; gap:4px 16px; margin:12px 0; font-size:14px; }
  dt { color:var(--muted); }
  dd { margin:0; overflow-wrap:anywhere; }
  h3 { font-size:13px; color:var(--muted); margin:12px 0 2px; }
  p { margin:0; font-size:14px; white-space:pre-wrap; }
  .mono, pre { font-family:Consolas,"Cascadia Code",monospace; }
  details { margin-top:12px; }
  summary { cursor:pointer; color:var(--muted); font-size:13px; }
  pre { background:var(--code); border-radius:8px; padding:12px; font-size:12px; overflow:auto; max-height:420px; white-space:pre-wrap; overflow-wrap:anywhere; }
  .sev { display:inline-block; padding:1px 9px; border-radius:999px; font-size:12px; font-weight:600; text-transform:uppercase; white-space:nowrap; }
  .sev.critical { background:#7a1f2b; color:#fff; } .sev.high { background:#c0392b; color:#fff; }
  .sev.medium { background:#e67e22; color:#fff; } .sev.low { background:#d4ac0d; color:#1b2230; }
  .sev.info { background:#3b82c4; color:#fff; }
  .empty { color:var(--muted); padding:24px 0; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>${esc(sourceTool.toUpperCase())} · ${esc(filename)}</h1>
    <p>${findings.length} finding(s) ${countChips}</p>
  </header>
  ${findings.length ? cards : '<p class="empty">ไม่พบช่องโหว่ในผลสแกนนี้</p>'}
</div>
</body>
</html>`;
}
