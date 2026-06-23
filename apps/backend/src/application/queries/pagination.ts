import type { SQL, AnyColumn } from 'drizzle-orm';
import { asc, desc, sql } from 'drizzle-orm';
import { procedures } from '../../db/schema/index.js';

/**
 * Columns a client is allowed to sort the procedure list by (PQ-3).
 * Whitelisted to prevent SQL injection via arbitrary column names.
 * `importe_total` is an aggregate alias produced by the list query.
 */
export const SORTABLE_FIELDS = [
  'fecha_publicacion',
  'fecha_apertura',
  'numero_procedimiento',
  'tipo_contratacion',
  'estatus',
  'importe_total',
] as const;

export type SortableField = (typeof SORTABLE_FIELDS)[number];

export type SortDirection = 'asc' | 'desc';

/** Pagination metadata returned with every list page. */
export interface PaginationMeta {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

/**
 * snake_case sort field → Drizzle column expression (camelCase table props).
 * `importe_total` is special: it orders by the aggregate output-column alias.
 */
const SORT_COLUMN_MAP: Record<SortableField, SQL | AnyColumn> = {
  fecha_publicacion: procedures.fechaPublicacion,
  fecha_apertura: procedures.fechaApertura,
  numero_procedimiento: procedures.numeroProcedimiento,
  tipo_contratacion: procedures.tipoContratacion,
  estatus: procedures.estatus,
  // Output-column alias; Postgres permits ORDER BY <alias>.
  importe_total: sql.raw('importe_total'),
};

/**
 * Compute the offset/limit slice and total page count for a page request.
 * Pure function — unit-tested independently of the database.
 */
export function computePagination(
  page: number,
  pageSize: number,
  total: number,
): { offset: number; limit: number; meta: PaginationMeta } {
  const safePage = Math.max(1, Math.trunc(page));
  const safeSize = Math.max(1, Math.trunc(pageSize));
  const totalPages = total === 0 ? 0 : Math.ceil(total / safeSize);
  // Offset is allowed to exceed the row count: a request beyond the last page
  // simply yields an empty page instead of erroring (PQ scenario 4).
  const offset = (safePage - 1) * safeSize;
  return {
    offset,
    limit: safeSize,
    meta: { page: safePage, page_size: safeSize, total, total_pages: totalPages },
  };
}

/**
 * Map a (whitelisted) sort field + direction to a Drizzle orderBy expression.
 * Unknown / empty fields fall back to `fecha_publicacion` (PQ-3 sortable cols).
 */
export function resolveSort(
  field: string | undefined,
  direction: SortDirection,
): { orderBy: SQL; field: SortableField } {
  const isValid = (SORTABLE_FIELDS as readonly string[]).includes(field ?? '');
  const resolved: SortableField = isValid ? (field as SortableField) : 'fecha_publicacion';
  const expr = SORT_COLUMN_MAP[resolved];
  return {
    orderBy: direction === 'desc' ? desc(expr) : asc(expr),
    field: resolved,
  };
}
