import { getLoginHost } from '$lib/server/oauth.js';

function sanitizeReturnTo(value) {
	if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
	return value;
}

export async function load({ url }) {
	return {
		returnTo: sanitizeReturnTo(url.searchParams.get('returnTo')),
		loginHost: getLoginHost()
	};
}
