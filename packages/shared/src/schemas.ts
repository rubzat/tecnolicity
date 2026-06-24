import { z } from 'zod';

/** Pagination query params shared by list endpoints. */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).default('asc'),
});

export type PaginationParams = z.infer<typeof paginationSchema>;

/**
 * Multi-dimension filter shared by the procedure list AND every analytics
 * endpoint (CA-6: all aggregations respect the same filters as procedure-query).
 *
 * Query-string names are snake_case to match the REST API contract
 * (`?tipo_contratacion=...&monto_min=...`). Categorical fields match exactly
 * (indexed); free-text fields (`institucion`, `proveedor`, `q`) match via ILIKE.
 */
export const procedureFilterSchema = z.object({
  institucion: z.string().trim().min(1).optional(),
  tipo_contratacion: z.string().trim().min(1).optional(),
  tipo_procedimiento: z.string().trim().min(1).optional(),
  estatus: z.string().trim().min(1).optional(),
  proveedor: z.string().trim().min(1).optional(),
  ley: z.string().trim().min(1).optional(),
  monto_min: z.coerce.number().nonnegative().optional(),
  monto_max: z.coerce.number().nonnegative().optional(),
  fecha_desde: z.string().trim().min(1).optional(),
  fecha_hasta: z.string().trim().min(1).optional(),
  q: z.string().trim().min(1).optional(),
});

export type ProcedureFilter = z.infer<typeof procedureFilterSchema>;

/** Procedure list query = filters + pagination + sorting. */
export const procedureListQuerySchema = procedureFilterSchema.extend({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum([
    'fecha_publicacion',
    'fecha_apertura',
    'numero_procedimiento',
    'tipo_contratacion',
    'estatus',
    'importe_total',
  ]).default('fecha_publicacion'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export type ProcedureListQuery = z.infer<typeof procedureListQuerySchema>;

/**
 * Analytics query = filters + an optional `limit` for the ranked endpoints
 * (by-institucion, top-proveedores). Default 10, max 100.
 */
export const analyticsQuerySchema = procedureFilterSchema.extend({
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

/**
 * Supplier Intelligence (PR9) — search query.
 *
 * `q` matches against supplier `nombre` (accent-insensitive substring) OR `rfc`
 * (case-insensitive substring). Results are pre-aggregated with each supplier's
 * total contracts + total amount so the user can gauge size before clicking.
 * Page size is capped at 50 (a search dropdown never needs more).
 */
export const supplierSearchSchema = z.object({
  q: z.string().trim().min(1).max(200),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(50).default(10),
});

export type SupplierSearchQuery = z.infer<typeof supplierSearchSchema>;

/**
 * Product Price Intelligence (PR10) — keyword parsing.
 *
 * The Product endpoints take a comma-separated `q` (NOT a pre-parsed tsquery —
 * the use case builds the tsquery via `buildSegmentTsQuery`). There is NO
 * default keyword set: if `q` is absent/empty the request is rejected by the
 * zod schema; if every keyword trims to empty after splitting, it is also
 * rejected here so the use case never sees an empty array.
 *
 * Mirrors {@link parseSegmentParam}'s normalization (split on commas/newlines,
 * trim, collapse internal whitespace, drop empties + case-insensitive dups),
 * but with NO fallback.
 */
export function parseProductKeywords(raw: string): string[] {
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
  return keywords;
}

/**
 * Product Price Intelligence schemas (PR10).
 *
 * `q` is a comma-separated keyword list (1..500 chars — generous ceiling so
 * many keywords fit, but bounded to keep the URL finite). `group_by` defaults
 * to "year" and must be one of year | quarter | month. `limit` defaults to 10
 * (max 50 — a top-N list never needs more), `page` defaults to 1, `page_size`
 * defaults to 20 (max 100, same ceiling as the procedure list).
 */
const productKeywordField = z.string().trim().min(1).max(500);
const productGroupByField = z.enum(['year', 'quarter', 'month']).default('year');
const productLimitField = z.coerce.number().int().min(1).max(50).default(10);

export const productPriceHistorySchema = z.object({
  q: productKeywordField,
  group_by: productGroupByField,
});

export const productDistributionSchema = z.object({
  q: productKeywordField,
});

export const productSuppliersSchema = z.object({
  q: productKeywordField,
  limit: productLimitField,
});

export const productTopContractsSchema = z.object({
  q: productKeywordField,
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export type ProductPriceHistoryQuery = z.infer<typeof productPriceHistorySchema>;
export type ProductDistributionQuery = z.infer<typeof productDistributionSchema>;
export type ProductSuppliersQuery = z.infer<typeof productSuppliersSchema>;
export type ProductTopContractsQuery = z.infer<typeof productTopContractsSchema>;
