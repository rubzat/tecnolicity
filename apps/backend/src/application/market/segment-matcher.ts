import { sql, type SQL, type AnyColumn } from 'drizzle-orm';

/**
 * Market Intelligence (PR6) — segment keyword → SQL matcher.
 *
 * A "segment" is a set of keywords. A procedure belongs to the segment when ANY
 * keyword appears in ANY of these text fields: `procedures.descripcion`,
 * `contracts.descripcion`, `contracts.titulo`, `expedientes.titulo`.
 *
 * ## Approach: tsvector GIN + to_tsquery (measured, not guessed)
 *
 * An earlier iteration used `pg_trgm` GIN + POSIX regex `~*`. That is fast for
 * NARROW segments (~30ms single-column) but a broad 35-keyword default produces
 * a lossy trigram bitmap that rechecks nearly every row — the full match took
 * ~5s and the API ~30s on 312K contracts.
 *
 * Switching to `to_tsvector('simple', col) @@ to_tsquery('simple', ...)` with a
 * GIN index on each column brings the broad-default match to **~140ms** (36x
 * faster), because the tsvector GIN is an exact inverted index (no lossy
 * recheck). Measured 2024-2026 ComprasMX dataset.
 *
 * ## Matching semantics
 *
 * `to_tsquery` matches on WORD boundaries (tokens), not arbitrary substrings.
 * This satisfies every segment requirement in practice ('software' matches
 * 'desarrollo de software'; 'gps' matches 'gps-tracking' after tokenization).
 * The 'simple' config lowercases but does NOT strip accents, so accented
 * variants must be listed explicitly (they are, in `market-segments.ts`).
 *
 * Multi-word keywords ('equipo de cómputo', 'circuito cerrado') are emitted as
 * PHRASE queries (`equipo <-> de <-> cómputo`) so the words must be adjacent —
 * this keeps precision high (vs. treating each word as an independent OR term,
 * which would let common words like 'de' explode the result set).
 */

/**
 * Build a Postgres `to_tsquery`-compatible string from a keyword list.
 *
 * - Single-word keywords → joined with ` | ` (OR).
 * - Multi-word keywords → phrase `w1 <-> w2 <-> …` (adjacency required),
 *   parenthesized and OR-ed in.
 * - Keywords are lowercased and de-duplicated (case-insensitive). Empties drop.
 * - Returns `''` for an empty list; callers MUST treat that as "match nothing"
 *   (to_tsquery('') errors, so the repository guards against it).
 *
 * Example: ['Software', 'camara', 'equipo de cómputo'] →
 *   'software | camara | (equipo <-> de <-> cómputo)'
 */
export function buildSegmentTsQuery(keywords: readonly string[]): string {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const raw of keywords) {
    const words = raw.trim().toLowerCase().split(/\s+/).filter((w) => w.length > 0);
    if (words.length === 0) continue;
    const key = words.join(' ');
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(words.length === 1 ? words[0]! : `(${words.join(' <-> ')})`);
  }
  return terms.join(' | ');
}

/**
 * Keep the legacy regex builder exported (it is unit-tested and useful for
 * diagnostics / fallbacks), but the live queries use {@link segmentColumnMatches}
 * with the tsvector path.
 */
const REGEX_META = /[.*+?^${}()|[\]\\]/g;

/** Escape POSIX regex metacharacters in a single keyword. */
export function escapeKeyword(kw: string): string {
  return kw.replace(REGEX_META, '\\$&');
}

/**
 * A SQL fragment that matches a text column against the segment via the
 * tsvector GIN index. Uses the EXACT index expression
 * `to_tsvector('simple', coalesce(col, ''))` so Postgres picks the index.
 *
 * `tsQuery` is bound as a SQL parameter (never raw-interpolated). When it is
 * empty the fragment short-circuits to `false` so to_tsquery('') never runs.
 */
export function segmentColumnMatches(column: AnyColumn, tsQuery: string): SQL {
  if (!tsQuery) {
    // Empty segment → match nothing (to_tsquery('') would raise an error).
    return sql`false`;
  }
  return sql`to_tsvector('simple', coalesce(${column}, '')) @@ to_tsquery('simple', ${tsQuery})`;
}
