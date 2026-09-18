/** Single source of truth for bounded result sets. */
export const SEARCH_RESULT_LIMIT = 20;
/** Default cap that sizes the `--page-all` single request (search). */
export const PAGE_ALL_DEFAULT_MAX = 50;
/**
 * Candidate window for `search --exact`.
 *
 * ADT quickSearch has no exact-name mode, so `--exact` widens the query to
 * `*NAME*` and filters client-side. Fetching only `--limit` (default 20)
 * candidates made an exact hit outside that window look like "no matches"
 * (`abap search TADIR --exact` returned nothing while `abap search TADIR` found
 * it) — feedback F-13 / F-28. The scan window is deliberately much larger than
 * any normal page.
 */
export const SEARCH_EXACT_SCAN_LIMIT = 200;
