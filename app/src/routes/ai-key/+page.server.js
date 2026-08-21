import { getUserAiKey, setUserAiKey, deleteUserAiKey } from '$lib/server/db.js';
import { DEFAULT_BASE_URL, DEFAULT_MODEL } from '$lib/server/ai.js';

export async function load({ locals }) {
	const email = locals.user.email;
	const existing = await getUserAiKey(email);
	return {
		connected: Boolean(existing),
		baseUrl: existing?.base_url ?? DEFAULT_BASE_URL,
		model: existing?.model ?? DEFAULT_MODEL,
		updatedAt: existing?.updated_at ?? null,
		defaultBaseUrl: DEFAULT_BASE_URL,
		defaultModel: DEFAULT_MODEL
	};
}

export const actions = {
	save: async ({ request, locals }) => {
		const form = await request.formData();
		const apiKey = String(form.get('apiKey') ?? '').trim();
		const baseUrl = String(form.get('baseUrl') ?? '').trim() || null;
		const model = String(form.get('model') ?? '').trim() || null;

		if (!apiKey) {
			return { error: 'ต้องระบุ API key' };
		}

		await setUserAiKey({ email: locals.user.email, apiKey, baseUrl, model });
		return { success: true };
	},
	disconnect: async ({ locals }) => {
		await deleteUserAiKey(locals.user.email);
		return { success: true, disconnected: true };
	}
};
