import { json, error } from '@sveltejs/kit';
import { getActivityBreakdown } from '$lib/server/db.js';

const VALID_PERIODS = ['day', 'week', 'month', 'year'];

export async function GET({ url }) {
	const period = url.searchParams.get('period') || 'month';
	if (!VALID_PERIODS.includes(period)) {
		throw error(400, 'invalid period');
	}
	const series = await getActivityBreakdown(period);
	return json({ period, series });
}
