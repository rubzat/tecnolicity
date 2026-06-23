/**
 * Date normalizer — handles the MIXED date formats in the ComprasMX export (CI-3).
 *
 * Two formats coexist in the same file:
 *   • ISO  "YYYY-MM-DD HH:mm:ss"  (e.g. fecha_publicacion)
 *   • DMY  "DD/MM/YYYY"            (e.g. fecha_inicio del contrato)
 *
 * Each column has a fixed format (see columns.DATE_FORMATS), but we also support
 * `auto` detection for robustness. Unparseable values return `null` (never throw)
 * per spec CI-3; callers decide whether null is quarantinable.
 */

export type DateFormat = 'iso' | 'dmy' | 'auto';

const ISO_RE = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?/;
const DMY_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/;

/** Detect whether a value looks ISO or DD/MM/YYYY. */
export function detectFormat(value: string): DateFormat {
  if (ISO_RE.test(value)) return 'iso';
  if (DMY_RE.test(value)) return 'dmy';
  return 'auto';
}

/**
 * Normalize a CSV date string to an ISO-8601 TIMESTAMP string (UTC),
 * e.g. "2026-03-23T20:33:39.000Z". Use this for `timestamptz` columns.
 * Returns null for empty / unparseable input.
 */
export function normalizeTimestamp(
  value: string | undefined | null,
  format: DateFormat = 'auto',
): string | null {
  const v = (value ?? '').trim();
  if (!v) return null;

  const fmt = format === 'auto' ? detectFormat(v) : format;

  if (fmt === 'iso') {
    // Accept "YYYY-MM-DD HH:mm:ss" or "YYYY-MM-DD" — normalise the separator.
    let s = v.includes('T') ? v : v.replace(' ', 'T');
    // Source datetimes carry NO timezone. Interpret them as UTC (append Z) so
    // toISOString() preserves the wall-clock components losslessly and the
    // behaviour is deterministic across host timezones. If we later learn the
    // source is Mexico City time, a migration can shift it by +6h.
    if (!/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) s += 'Z';
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  if (fmt === 'dmy') {
    const m = v.match(DMY_RE);
    if (!m) return null;
    const dd = m[1]!.padStart(2, '0');
    const mm = m[2]!.padStart(2, '0');
    const yyyy = m[3];
    const d = new Date(`${yyyy}-${mm}-${dd}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  return null;
}

/**
 * Normalize to a plain DATE string "YYYY-MM-DD" (no time), for `date` columns.
 * Returns null for empty / unparseable input.
 */
export function normalizeDateOnly(
  value: string | undefined | null,
  format: DateFormat = 'auto',
): string | null {
  const iso = normalizeTimestamp(value, format);
  return iso ? iso.slice(0, 10) : null;
}
