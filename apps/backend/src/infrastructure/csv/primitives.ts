/**
 * Parsing primitives for sparse / ambiguous CSV scalar values.
 * All functions return null on missing/invalid input — never throw.
 */

/** Trim to a non-empty string or null. */
export function nullableString(value: string | undefined | null): string | null {
  if (value == null) return null;
  const t = value.trim();
  return t === '' ? null : t;
}

/**
 * Parse a numeric amount (numeric(18,2)). ComprasMX amounts use `.` as the
 * decimal separator and occasionally include `,` thousands separators — those
 * are stripped. Returns the number as a STRING (Drizzle numeric accepts strings
 * losslessly); null if empty or non-numeric (CI-4: nullable sparse amounts).
 */
export function parseMoney(value: string | undefined | null): string | null {
  if (value == null) return null;
  const t = value.trim();
  if (!t) return null;
  // Strip thousands separators; keep a single decimal point and optional sign.
  const normalized = t.replace(/,/g, '').trim();
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  return normalized;
}

/**
 * Map SI/NO (Spanish) or true/false to a boolean. Returns null when blank or
 * ambiguous. Used for contrato_marco, compra_consolidada, casofortuito,
 * credito_externo, contrato_plurianual, convenio_modificatorio.
 */
export function parseBoolean(value: string | undefined | null): boolean | null {
  if (value == null) return null;
  const t = value.trim().toUpperCase();
  if (t === 'SI' || t === 'SÍ' || t === 'TRUE' || t === '1' || t === 'VERDADERO')
    return true;
  if (t === 'NO' || t === 'FALSE' || t === '0' || t === 'FALSO') return false;
  return null;
}
