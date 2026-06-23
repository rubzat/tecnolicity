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
