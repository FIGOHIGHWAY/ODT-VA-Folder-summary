import { getSetting, setSetting } from '$lib/server/db.js';
import { AI_PROMPT_SETTING_KEY, DEFAULT_SYSTEM_PROMPT } from '$lib/server/ai.js';

export async function load() {
	const stored = await getSetting(AI_PROMPT_SETTING_KEY);
	return {
		prompt: stored ?? DEFAULT_SYSTEM_PROMPT,
		isDefault: stored === null,
		defaultPrompt: DEFAULT_SYSTEM_PROMPT
	};
}

export const actions = {
	save: async ({ request, locals }) => {
		const form = await request.formData();
		const value = String(form.get('prompt') ?? '').trim();
		if (!value) {
			return { error: 'Prompt ต้องไม่เว้นว่าง' };
		}
		await setSetting({
			key: AI_PROMPT_SETTING_KEY,
			value,
			updatedBy: locals.user?.email ?? null
		});
		return { success: true };
	},
	reset: async ({ locals }) => {
		await setSetting({
			key: AI_PROMPT_SETTING_KEY,
			value: DEFAULT_SYSTEM_PROMPT,
			updatedBy: locals.user?.email ?? null
		});
		return { success: true, reset: true };
	}
};
