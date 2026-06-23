import { z } from 'zod';

/**
 * Market Intelligence (PR6) — segment keyword sets.
 *
 * The portal data has NO "rubro"/category column, so a market segment is
 * defined by a list of keywords matched (case-insensitive, as substrings)
 * against `procedures.descripcion`, `contracts.descripcion`, `contracts.titulo`
 * and `expedientes.titulo`.
 *
 * These defaults cover Tecnolicity's commercial focus: software/IT and
 * equipment/security. Accent variants are listed explicitly so ILIKE matches
 * regardless of whether the source stored 'cámara' or 'camara' (the ComprasMX
 * dump is inconsistent). The Postgres side also uses trigram indexes that are
 * accent-sensitive, so listing both forms is the robust choice.
 *
 * The frontend may override this set (user can add/remove keywords); the
 * active list is sent as the `?segment=kw1,kw2,...` query param.
 */

export const SOFTWARE_IT_KEYWORDS = [
  // Singular forms suffice: `~*` is SUBSTRING matching, so 'sistema' already
  // matches 'sistemas', 'sistemático', etc. Plurals would only inflate the
  // regex alternation (and slow the trigram match) without adding recall.
  'software',
  'licencia',
  'sistema',
  'aplicación',
  'aplicacion',
  'cómputo',
  'computo',
  'computadora',
  'equipo de cómputo',
  'equipo de computo',
  'servidor',
  'redes',
  'networking',
  'informática',
  'informatica',
  'tecnología de la información',
  'tecnologia de la informacion',
  'base de datos',
  'plataforma digital',
] as const;

export const EQUIPMENT_SECURITY_KEYWORDS = [
  // Substring matching: 'cámara' covers 'cámaras', 'videovigilancia' is singular-use, etc.
  'cámara',
  'camara',
  'cctv',
  'videovigilancia',
  'video vigilancia',
  'circuito cerrado',
  'control de acceso',
  'seguridad electrónica',
  'seguridad electronica',
  'equipo de comunicación',
  'equipo de comunicacion',
  'radiocomunicación',
  'radiocomunicacion',
  'gps',
  'geolocalización',
  'geolocalizacion',
] as const;

/** Default segment for Tecnolicity (software/IT + equipment/security). */
export const DEFAULT_MARKET_KEYWORDS: readonly string[] = [
  ...SOFTWARE_IT_KEYWORDS,
  ...EQUIPMENT_SECURITY_KEYWORDS,
];

/**
 * Parse a `?segment=kw1,kw2,...` query string into a clean keyword list.
 * - Split on commas/newlines.
 * - Trim + collapse internal whitespace.
 * - Drop empties and duplicates (case-insensitive).
 * - Falls back to {@link DEFAULT_MARKET_KEYWORDS} when the param is absent/empty.
 *
 * Returns the normalized list and the raw input (for echo-back in responses).
 */
export function parseSegmentParam(raw: string | undefined | null): {
  keywords: string[];
  usedDefault: boolean;
} {
  if (!raw || !raw.trim()) {
    return { keywords: [...DEFAULT_MARKET_KEYWORDS], usedDefault: true };
  }
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const part of raw.split(/[\n,]+/)) {
    const kw = part.trim().replace(/\s+/g, ' ');
    if (!kw) continue;
    const key = kw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    keywords.push(kw);
  }
  if (keywords.length === 0) {
    return { keywords: [...DEFAULT_MARKET_KEYWORDS], usedDefault: true };
  }
  return { keywords, usedDefault: false };
}

/** Zod schema for the market query params (shared by every market endpoint). */
export const marketQuerySchema = z.object({
  /** Comma-separated keywords. Empty/absent → DEFAULT_MARKET_KEYWORDS. */
  segment: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

/** Pagination-aware variant for the opportunities endpoint. */
export const marketPagedQuerySchema = marketQuerySchema.extend({
  page: z.coerce.number().int().min(1).default(1),
});

/** Window (months) for the expiring endpoint. */
export const marketExpiringQuerySchema = marketQuerySchema.extend({
  months: z.coerce.number().int().min(1).max(36).default(6),
});

export type MarketQuery = z.infer<typeof marketQuerySchema>;
export type MarketPagedQuery = z.infer<typeof marketPagedQuerySchema>;
export type MarketExpiringQuery = z.infer<typeof marketExpiringQuerySchema>;
