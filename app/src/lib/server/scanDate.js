/**
 * Best-effort extraction of the actual scan date from a report's original
 * filename (e.g. "2026072101-Nessus.html", "2026-07-31-Nessus-Report-x.html",
 * "20251127-nessus.html") — many scan exports are uploaded well after the
 * scan actually ran (batch catch-up imports), so the upload timestamp
 * (`imported_at`) can be months off from when the scan was really taken.
 * Filenames that don't start with a recognizable date (e.g. IP-based or
 * hashed Nessus export names) return null, and the caller should fall back
 * to `imported_at`.
 * @param {string} filename
 * @returns {Date|null}
 */
export function extractScanDateFromFilename(filename) {
	const match = filename.match(/^(\d{4})(-?)(\d{2})\2(\d{2})/);
	if (!match) return null;

	const year = Number(match[1]);
	const month = Number(match[3]);
	const day = Number(match[4]);

	if (year < 2015 || year > 2035) return null;
	if (month < 1 || month > 12) return null;
	if (day < 1 || day > 31) return null;

	const date = new Date(Date.UTC(year, month - 1, day));
	// Guards against e.g. day=31 in a 30-day month rolling over to the next month.
	if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
		return null;
	}
	return date;
}
