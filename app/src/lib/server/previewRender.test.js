import { describe, it, expect } from 'vitest';
import { isRawScanOutput, renderScanPreview } from './previewRender.js';

const nucleiLine = JSON.stringify({
	'template-id': 'waf-detect',
	host: 'hrd.computing.kku.ac.th',
	'matched-at': 'https://hrd.computing.kku.ac.th',
	info: { name: 'WAF <b>Detection</b>', severity: 'info', description: 'x' },
	request: "POST / HTTP/1.1\r\n\r\n_=<script>alert(1)</script>"
});

describe('renderScanPreview', () => {
	it('escapes attacker-influenced scan data instead of rendering it as markup', () => {
		const html = renderScanPreview({ sourceTool: 'nuclei', filename: 'n.jsonl', raw: nucleiLine });
		expect(html).not.toContain('<script>alert(1)</script>');
		expect(html).not.toContain('<b>Detection</b>');
		expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
		expect(html).toContain('WAF &lt;b&gt;Detection&lt;/b&gt;');
	});

	it('shows a no-findings message for an empty scan', () => {
		const html = renderScanPreview({ sourceTool: 'nuclei', filename: 'n.jsonl', raw: '' });
		expect(html).toContain('ไม่พบช่องโหว่ในผลสแกนนี้');
	});
});

describe('isRawScanOutput', () => {
	it('renders live-scan JSON but leaves uploaded HTML exports alone', () => {
		expect(isRawScanOutput('nuclei', nucleiLine)).toBe(true);
		expect(isRawScanOutput('zap', '[{"alert":"x"}]')).toBe(true);
		expect(isRawScanOutput('zap', '<!doctype html><html></html>')).toBe(false);
		expect(isRawScanOutput('nessus', '<html></html>')).toBe(false);
	});
});
