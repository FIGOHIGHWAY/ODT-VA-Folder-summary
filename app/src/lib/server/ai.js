import { env } from '$env/dynamic/private';

/**
 * AI-generated remediation summary for a domain's findings, via an
 * OpenAI-compatible chat-completions gateway (e.g. KKU AI Gateway,
 * gen.ai.kku.ac.th). Each user brings their own API key — there is no
 * shared/global key — so a user who hasn't connected one yet simply can't
 * use this feature (see `/ai-key`).
 */

const DEFAULT_BASE_URL = env.KKU_AI_BASE_URL ?? 'https://gen.ai.kku.ac.th';
const DEFAULT_MODEL = env.KKU_AI_MODEL ?? 'claude-sonnet-5';
const CONTACT_EMAIL = env.AI_SUMMARY_CONTACT_EMAIL ?? 'phonhat@kku.ac.th';

export { DEFAULT_BASE_URL, DEFAULT_MODEL };

export const AI_PROMPT_SETTING_KEY = 'ai_system_prompt';

export const DEFAULT_SYSTEM_PROMPT = [
	'คุณเป็นผู้ช่วยสรุปผลสแกนความปลอดภัย (VA scan) สำหรับทีมดูแลระบบ',
	'สรุปเป็นภาษาไทย กระชับ ตรงประเด็น เน้น finding ที่ severity สูงสุดก่อน',
	'ตอบกลับให้ตรงรูปแบบนี้เท่านั้น (ห้ามใส่ข้อความอื่นนอกรูปแบบ):',
	'',
	'ให้ดำเนินการตามนี้',
	'- <รายการที่ต้องแก้ไข ข้อที่ 1>',
	'- <รายการที่ต้องแก้ไข ข้อที่ 2>',
	'- ...(ไม่เกิน 8 ข้อ เรียงตามความรุนแรง)',
	'',
	'หรือหากพบปัญหาการแก้ไขติดต่อมาที่ {{CONTACT_EMAIL}}'
].join('\n');

/**
 * Render a system-prompt template, substituting the {{CONTACT_EMAIL}}
 * placeholder. Used for both the built-in default and any admin override.
 * @param {string} template
 */
export function renderSystemPrompt(template) {
	return template.replaceAll('{{CONTACT_EMAIL}}', CONTACT_EMAIL);
}

const SEVERITY_LABEL_TH = {
	critical: 'วิกฤต',
	high: 'สูง',
	medium: 'กลาง',
	low: 'ต่ำ',
	info: 'ข้อมูล'
};

/**
 * Build a compact, token-conscious digest of a domain's findings for the
 * prompt — full descriptions/raw_evidence are dropped, capped at 40 findings
 * (most severe first, as `findings` is already ordered) so very large
 * domains don't blow the context window.
 * @param {Array<object>} findings
 */
function digestFindings(findings) {
	const capped = findings.slice(0, 40);
	const lines = capped.map((f, i) => {
		const sev = SEVERITY_LABEL_TH[f.severity] ?? f.severity;
		const cve = f.cve ? ` (${f.cve})` : '';
		return `${i + 1}. [${sev}] ${f.title}${cve} — ${f.solution || 'ไม่มีคำแนะนำการแก้ไขในรายงาน'}`;
	});
	const omitted = findings.length - capped.length;
	if (omitted > 0) {
		lines.push(`...และอีก ${omitted} finding ที่ไม่ได้แสดง (severity ต่ำกว่ารายการข้างต้น)`);
	}
	return lines.join('\n');
}

/**
 * Ask the caller's own configured model to summarize a domain's findings
 * into a short, actionable Thai-language remediation notice. Uses the
 * caller's personal API key/base URL/model — never a shared/global one.
 * @param {{
 *   domain: string, findings: Array<object>, systemPromptTemplate?: string,
 *   apiKey: string, baseUrl?: string|null, model?: string|null
 * }} params
 * @returns {Promise<{ summary: string, model: string }>}
 */
export async function summarizeFindings({
	domain,
	findings,
	systemPromptTemplate,
	apiKey,
	baseUrl,
	model
}) {
	if (!apiKey) {
		throw new Error('ยังไม่ได้เชื่อมต่อ AI ส่วนตัว — ไปตั้งค่า API key ของคุณที่หน้า "เชื่อมต่อ AI ของฉัน" ก่อน');
	}
	if (findings.length === 0) {
		throw new Error('ไม่มี finding ให้สรุป');
	}

	const effectiveBaseUrl = baseUrl || DEFAULT_BASE_URL;
	const effectiveModel = model || DEFAULT_MODEL;

	const digest = digestFindings(findings);
	const systemPrompt = renderSystemPrompt(systemPromptTemplate || DEFAULT_SYSTEM_PROMPT);
	const userPrompt = `Domain: ${domain}\n\nรายการ finding (${findings.length} รายการ):\n${digest}`;

	const res = await fetch(new URL('/api/v1/chat/completions', effectiveBaseUrl), {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			model: effectiveModel,
			messages: [
				{ role: 'system', content: systemPrompt },
				{ role: 'user', content: userPrompt }
			]
		})
	});

	const bodyText = await res.text();
	let body;
	try {
		body = JSON.parse(bodyText);
	} catch {
		throw new Error(`AI gateway ตอบไม่เป็น JSON: ${bodyText.slice(0, 500)}`);
	}

	if (!res.ok) {
		// Seen shapes so far: string `{ "error": "Invalid API key" }` and the
		// OpenAI-style `{ "error": { "message": "..." } }` — handle both.
		const message =
			typeof body.error === 'string' ? body.error : body.error?.message ?? JSON.stringify(body);
		throw new Error(`AI gateway ตอบ ${res.status}: ${message.slice(0, 500)}`);
	}

	const content = body.choices?.[0]?.message?.content;
	if (!content) {
		throw new Error(`AI gateway ไม่มี choices[0].message.content: ${bodyText.slice(0, 500)}`);
	}

	return { summary: content.trim(), model: effectiveModel };
}
