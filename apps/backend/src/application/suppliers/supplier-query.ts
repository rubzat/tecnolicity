/**
 * Supplier Intelligence (PR9) — query normalization.
 *
 * The search must be accent-INSENSITIVE: 2,537 suppliers in the dataset have
 * accented names (CABAÑAS, ANÁLISIS…), and a plain ILIKE '%camara%' misses
 * 'Cámara'. The Postgres side has no `unaccent` extension installed, so we
 * normalize on BOTH ends:
 *
 *  - Here (JS): lowercase + NFD-strip combining marks + escape LIKE wildcards.
 *  - In the repository (SQL): `translate(lower(nombre), accented, plain)` on
 *    the stored column so the comparison is accent-free on both sides.
 *
 * NFD decomposition + removing the U+0300–U+036F combining-mark range is the
 * standard way to strip diacritics in JS (covers áéíóúüñç and their uppercase
 * forms, plus foreign diacritics). It is a pure function — unit-tested.
 */

const LIKE_WILDCARD = /[%_\\]/g;

/**
 * Normalize a raw user query into a LIKE operand: lowercased, accents stripped,
 * and LIKE wildcard characters escaped (so a literal `%`/`_` in the query is
 * not treated as a wildcard). Returns the trimmed needle WITHOUT surrounding
 * `%` — the repository wraps it per-column (substring for names, prefix for
 * RFC). Returns '' for empty/whitespace input.
 */
export function buildSupplierSearchPredicate(raw: string): string {
  const stripped = raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  // Escape LIKE metacharacters with a backslash so they match literally.
  // (The repository emits LIKE ... ESCAPE '\'.)
  return stripped.replace(LIKE_WILDCARD, '\\$&');
}
