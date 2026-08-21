import { json, error } from '@sveltejs/kit';
import { listFindingsForDomain, saveAiSummary, getSetting, getUserAiKey } from '$lib/server/db.js';
import { summarizeFindings, AI_PROMPT_SETTING_KEY } from '$lib/server/ai.js';

export async function POST({ request, locals }) {
	const email = locals.user?.email;
	if (!email) {
		return json({ error: 'ต้องเข้าสู่ระบบก่อนใช้งาน' }, { status: 401 });
	}

	const userKey = await getUserAiKey(email);
	if (!userKey) {
		return json(
			{ error: 'คุณยังไม่ได้เชื่อมต่อ AI ของตัวเอง — ไปตั้งค่าที่หน้า "เชื่อมต่อ AI ของฉัน" ก่อน' },
			{ status: 400 }
		);
	}

	const { domain } = await request.json();
	if (!domain || typeof domain !== 'string') {
		return json({ error: 'ต้องระบุ domain' }, { status: 400 });
	}

	const findings = await listFindingsForDomain(domain);
	if (findings.length === 0) {
		return json({ error: `ไม่พบ finding ของ domain "${domain}"` }, { status: 404 });
	}

	try {
		const systemPromptTemplate = await getSetting(AI_PROMPT_SETTING_KEY);
		const { summary, model } = await summarizeFindings({
			domain,
			findings,
			systemPromptTemplate,
			apiKey: userKey.api_key,
			baseUrl: userKey.base_url,
			model: userKey.model
		});
		await saveAiSummary({ domain, summary, model, findingCount: findings.length });
		return json({ summary, model, findingCount: findings.length });
	} catch (err) {
		throw error(502, err instanceof Error ? err.message : String(err));
	}
}
