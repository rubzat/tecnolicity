import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ProcedureFilter, ProcedureListQuery, SortField, SortOrder } from '../types';

/** Filter keys that live in the URL search params. */
const FILTER_KEYS = [
  'institucion',
  'tipo_contratacion',
  'tipo_procedimiento',
  'estatus',
  'proveedor',
  'ley',
  'monto_min',
  'monto_max',
  'fecha_desde',
  'fecha_hasta',
  'q',
] as const;

const SORTABLE_FIELDS: readonly SortField[] = [
  'fecha_publicacion',
  'fecha_apertura',
  'numero_procedimiento',
  'tipo_contratacion',
  'estatus',
  'importe_total',
];

function isSortableField(v: string | null): v is SortField {
  return v !== null && (SORTABLE_FIELDS as readonly string[]).includes(v);
}

/** Default page size for the list. */
export const DEFAULT_PAGE_SIZE = 20;

/**
 * Filter + pagination + sort state, mirrored in the URL search params so any
 * filter selection is shareable and survives a refresh.
 *
 * Read/write happens through `update` and `reset`; the derived `query` is
 * passed to TanStack Query hooks.
 */
export function useProcedureListFilters() {
  const [searchParams, setSearchParams] = useSearchParams();

  const query: ProcedureListQuery = useMemo(() => {
    const filter: ProcedureFilter = {};
    for (const key of FILTER_KEYS) {
      const v = searchParams.get(key);
      if (v !== null && v !== '') {
        if (key === 'monto_min' || key === 'monto_max') {
          const n = Number(v);
          if (!Number.isNaN(n)) filter[key] = n;
        } else {
          filter[key] = v;
        }
      }
    }
    const sortParam = searchParams.get('sort');
    const orderParam = searchParams.get('order');
    const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
    const page_size = Math.min(
      100,
      Math.max(1, Number(searchParams.get('page_size') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE),
    );
    const sort: SortField = isSortableField(sortParam) ? sortParam : 'fecha_publicacion';
    const order: SortOrder = orderParam === 'asc' ? 'asc' : 'desc';
    return { ...filter, page, page_size, sort, order };
  }, [searchParams]);

  const update = useCallback(
    (patch: Partial<ProcedureListQuery>) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v === undefined || v === null || v === '' || Number.isNaN(v)) {
              next.delete(k);
            } else {
              next.set(k, String(v));
            }
          }
          // Any filter/sort change resets pagination — stale page numbers
          // would otherwise produce confusing empty result pages.
          if (Object.keys(patch).some((k) => k !== 'page' && k !== 'page_size')) {
            next.delete('page');
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const reset = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const key of FILTER_KEYS) next.delete(key);
        next.delete('page');
        next.delete('sort');
        next.delete('order');
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  /** Toggle sort field/order; clicking the active column flips direction. */
  const toggleSort = useCallback(
    (field: SortField) => {
      const isActive = query.sort === field;
      const nextOrder: SortOrder = isActive && query.order === 'desc' ? 'asc' : 'desc';
      update({ sort: field, order: nextOrder });
    },
    [query.sort, query.order, update],
  );

  const hasActiveFilters = FILTER_KEYS.some((k) => searchParams.get(k));

  return { query, update, reset, toggleSort, hasActiveFilters };
}

/** Type guard for filter-only state used by the analytics page. */
export type FilterState = ReturnType<typeof useProcedureListFilters>['query'];
