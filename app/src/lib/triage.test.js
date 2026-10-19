import { describe, it, expect } from 'vitest';
import { needsReviewReason, withoutFalsePositives } from './triage.js';

describe('needsReviewReason', () => {
	it('flags low and tentative scanner confidence', () => {
		expect(needsReviewReason({ source_tool: 'zap', title: 'XSS', confidence: 'Low' })).toMatch(/Low/);
		expect(needsReviewReason({ source_tool: 'burp', title: 'SQLi', confidence: 'Tentative' })).toMatch(/Tentative/);
	});

	it('flags version-only Nessus and OpenVAS checks', () => {
		expect(needsReviewReason({ source_tool: 'nessus', title: 'PHP 8.0.x < 8.0.30 Multiple Vulnerabilities' })).toMatch(/เวอร์ชัน/);
		expect(needsReviewReason({ source_tool: 'nessus', title: 'phpMyAdmin prior to 4.8.6 SQLi' })).toMatch(/เวอร์ชัน/);
		expect(needsReviewReason({ source_tool: 'openvas', title: 'PHP Unsupported Version Detection' })).toMatch(/เวอร์ชัน/);
	});

	it('leaves confident and non-version findings alone', () => {
		expect(needsReviewReason({ source_tool: 'zap', title: 'XSS', confidence: 'High' })).toBeNull();
		expect(needsReviewReason({ source_tool: 'nessus', title: 'ICMP Timestamp Request' })).toBeNull();
		// a ZAP title with "<" is not a version check
		expect(needsReviewReason({ source_tool: 'zap', title: 'PHP 8.0.x < 8.0.30' })).toBeNull();
	});

	it('stops flagging once someone has triaged the finding', () => {
		expect(needsReviewReason({ source_tool: 'zap', title: 'XSS', confidence: 'Low', triage_status: 'confirmed' })).toBeNull();
	});
});

describe('withoutFalsePositives', () => {
	it('drops only false positives', () => {
		const rows = [{ triage_status: null }, { triage_status: 'false_positive' }, { triage_status: 'accepted_risk' }];
		expect(withoutFalsePositives(rows)).toEqual([{ triage_status: null }, { triage_status: 'accepted_risk' }]);
	});
});
