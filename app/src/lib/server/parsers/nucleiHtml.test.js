import { describe, it, expect } from 'vitest';
import { parseNucleiHtml } from './nucleiHtml.js';
import { detectReportType } from './detect.js';

// Mirrors the structure of a real CVE sweep write-up (addresses are from the
// documentation ranges, not real hosts).
const REPORT = `<!doctype html><html><head><title>รายงาน CVE-2026-0001</title></head><body>
<header class="doc">
  <span class="tag">CRITICAL · RCE</span><span class="tag v">v2</span>
  <h1>รายงานการตรวจสอบช่องโหว่ CVE-2026-0001</h1>
  <div class="sub">Example Server <code>mod_x</code> Race Condition — Unauthenticated RCE</div>
  <div class="meta"><div>เครื่องมือ: <b>Nuclei v3.11.1, curl</b></div></div>
</header>
<h2>1. บทสรุปผู้บริหาร</h2>
<div class="panel"><p>ช่องโหว่ร้ายแรง (CVSS 9.8)</p>
  <div class="note crit"><b>สิ่งที่ต้องทำ:</b> อัปเกรดเป็น 2.4.71</div></div>
<h3>2.1 ยืนยันแล้ว (1 โฮสต์ public)</h3>
<div class="panel"><table><tbody>
  <tr><td class="ip">203.0.113.10</td><td class="mono">app.example.ac.th</td><td>ตอบรับ HTTP/2 ผ่าน ALPN</td><td><span class="badge b-crit">สูงสุด</span></td></tr>
</tbody></table><div class="note">ดูเวอร์ชันจากภายนอกไม่ได้</div></div>
<h3>2.2 แสดงเวอร์ชันอยู่ในช่วงที่กระทบ</h3>
<div class="panel"><table><tbody>
  <tr><td rowspan="2" class="mono">192.0.2.0/24<br><span class="sub">2 โฮสต์</span></td><td class="ip">192.0.2.5</td><td><span class="chip">2.4.58</span></td><td>HTTPS</td></tr>
  <tr><td class="ip">192.0.2.6</td><td><span class="chip">2.4.62</span></td><td>HTTP</td></tr>
</tbody></table><div class="note">ผลกลุ่มนี้เข้าข่ายตามเวอร์ชัน</div></div>
<h2>3. ผลไม่พบ</h2>
<div class="panel"><table><tbody>
  <tr><td class="mono">198.51.100.0/24</td><td>34</td><td><span class="badge b-ok">ไม่พบ</span></td></tr>
</tbody></table></div>
<div class="panel"><table><tbody>
  <tr><td class="ip">203.0.113.10</td><td class="mono">app.example.ac.th</td><td>h2 ✔</td><td><span class="badge b-crit">เสี่ยง</span></td></tr>
  <tr><td class="ip">203.0.113.20</td><td class="mono">other.example.ac.th</td><td>http/1.1</td><td><span class="badge b-ok">ไม่เปิด HTTP/2</span></td></tr>
</tbody></table></div>
<div class="panel"><div class="note"><b>มาตรการชั่วคราว:</b> ตั้ง Protocols http/1.1</div></div>
</body></html>`;

describe('parseNucleiHtml', () => {
	const findings = parseNucleiHtml(REPORT, 'test.html');
	const byIp = Object.fromEntries(findings.map((f) => [f.target, f]));

	it('keeps one finding per affected host, skipping not-affected and duplicate rows', () => {
		expect(findings.map((f) => f.target).sort()).toEqual(['192.0.2.5', '192.0.2.6', '203.0.113.10']);
	});

	it('takes CVE, title, severity and CVSS from the report header', () => {
		const f = byIp['203.0.113.10'];
		expect(f).toMatchObject({
			source_tool: 'nuclei',
			cve: 'CVE-2026-0001',
			identifier: 'CVE-2026-0001',
			severity: 'critical',
			cvss_score: 9.8
		});
		expect(f.title).toBe('CVE-2026-0001: Example Server mod_x Race Condition — Unauthenticated RCE');
	});

	it('uses the first (richest) row for a host and marks confirmed hosts firm', () => {
		const f = byIp['203.0.113.10'];
		expect(f.affected_url_or_port).toBe('https://app.example.ac.th');
		expect(f.confidence).toBe('firm');
		expect(f.description).toContain('ตอบรับ HTTP/2 ผ่าน ALPN');
		expect(f.description).toContain('2.1 ยืนยันแล้ว');
	});

	it('marks version-only matches tentative and keeps version and protocol', () => {
		const f = byIp['192.0.2.6'];
		expect(f.confidence).toBe('tentative');
		expect(f.affected_url_or_port).toBe('http://192.0.2.6');
		expect(f.description).toContain('ตรวจพบเวอร์ชัน 2.4.62');
		expect(f.description).not.toContain('192.0.2.0/24');
	});

	it('builds the solution from the action and stopgap notes', () => {
		expect(byIp['192.0.2.5'].solution).toContain('อัปเกรดเป็น 2.4.71');
		expect(byIp['192.0.2.5'].solution).toContain('ตั้ง Protocols http/1.1');
	});

	it('is detected as a nuclei report', () => {
		expect(detectReportType(REPORT, 'test.html')).toBe('nuclei');
	});

	it('throws when the report has no recognizable host rows', () => {
		const empty = REPORT.replace(/<td class="ip">/g, '<td>');
		expect(() => parseNucleiHtml(empty, 'x.html')).toThrow(/ไม่รู้จักโครงสร้าง/);
	});
});

// Vulnerability-list layout: many findings, each listing its affected hosts.
const VULN_LIST = `<!doctype html><html><head><title>รายงานผลการสแกนช่องโหว่ WordPress</title></head><body>
<header><h1>รายงานผลการสแกนช่องโหว่ WordPress</h1>
<div class="sub">เครื่องมือ Nuclei v3.11.1 · สแกนจาก 10.101.118.178</div></header>
<div class="card"><table><tbody>
  <tr class="r critical">
    <td><span class="badge critical">วิกฤต</span></td>
    <td class="tid"><code>CVE-2026-104736</code><div class="nm">LearnPress &lt;= 4.4.9.1 - PHP Object Injection</div></td>
    <td class="num">9.8</td><td class="num">2.5%</td><td class="cnt">2</td>
    <td class="hosts"><a class="host" href="https://ccahub.kku.ac.th">ccahub.kku.ac.th</a> <a class="host new" href="https://pharmacy.kku.ac.th">pharmacy.kku.ac.th ●</a></td>
  </tr>
  <tr class="d critical"><td></td><td colspan="5">
    <div class="imp"><b>ผลกระทบ:</b> ช่องโหว่ระดับยึดระบบในปลั๊กอิน LearnPress</div>
    <div class="fix"><b>แนวทางแก้ไข:</b> อัปเดต LearnPress เป็นเวอร์ชันล่าสุด</div>
    <div class="refs"><a href="https://wpscan.com/x">อ้างอิง</a></div>
  </td></tr>
  <tr class="r low">
    <td><span class="badge low">ต่ำ</span></td>
    <td class="tid"><code>wp-user-enum</code><div class="nm">WordPress REST API User Enumeration</div></td>
    <td class="num">–</td><td class="num">–</td><td class="cnt">1</td>
    <td class="hosts"><a class="host" href="https://apds.kku.ac.th">apds.kku.ac.th</a></td>
  </tr>
  <tr class="d low"><td></td><td colspan="5">
    <div class="imp"><b>ผลกระทบ:</b> แสดงรายชื่อบัญชีผู้ใช้ผ่าน REST API</div>
    <div class="fix"><b>แนวทางแก้ไข:</b> ปิดการแสดงรายชื่อผู้ใช้</div><div class="refs"></div>
  </td></tr>
</tbody></table></div></body></html>`;

describe('parseNucleiHtml — vulnerability-list layout', () => {
	const findings = parseNucleiHtml(VULN_LIST, 'wp.html');

	it('is detected as a nuclei report', () => {
		expect(detectReportType(VULN_LIST, 'wp.html')).toBe('nuclei');
	});

	it('emits one finding per (vulnerability, host)', () => {
		expect(findings).toHaveLength(3);
		expect(findings.map((f) => f.target).sort()).toEqual([
			'apds.kku.ac.th',
			'ccahub.kku.ac.th',
			'pharmacy.kku.ac.th'
		]);
	});

	it('reads severity, id, title, CVE and CVSS from the summary row', () => {
		const f = findings.find((x) => x.target === 'ccahub.kku.ac.th');
		expect(f).toMatchObject({
			source_tool: 'nuclei',
			severity: 'critical',
			identifier: 'CVE-2026-104736',
			cve: 'CVE-2026-104736',
			cvss_score: 9.8,
			confidence: 'tentative',
			affected_url_or_port: 'https://ccahub.kku.ac.th'
		});
		expect(f.title).toBe('LearnPress <= 4.4.9.1 - PHP Object Injection');
	});

	it('takes impact and fix from the detail row, stripping the Thai label', () => {
		const f = findings.find((x) => x.target === 'apds.kku.ac.th');
		expect(f.description).toContain('แสดงรายชื่อบัญชีผู้ใช้ผ่าน REST API');
		expect(f.description).not.toContain('ผลกระทบ:');
		expect(f.solution).toBe('ปิดการแสดงรายชื่อผู้ใช้');
	});

	it('leaves non-CVE template ids without a CVE and null CVSS when "–"', () => {
		const f = findings.find((x) => x.target === 'apds.kku.ac.th');
		expect(f.identifier).toBe('wp-user-enum');
		expect(f.cve).toBeNull();
		expect(f.cvss_score).toBeNull();
	});

	it('flags hosts marked ● as newly found', () => {
		const f = findings.find((x) => x.target === 'pharmacy.kku.ac.th');
		expect(f.description).toContain('พบเพิ่มในการสแกนรอบที่ 2');
	});
});
