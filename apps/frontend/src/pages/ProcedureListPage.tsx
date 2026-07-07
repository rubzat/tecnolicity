import { useState } from 'react';
import { useProcedureListFilters } from '../hooks/useProcedureListFilters';
import { useProcedures } from '../api/queries';
import { FilterSidebar } from '../components/FilterSidebar';
import { ProcedureTable } from '../components/ProcedureTable';
import { Pagination } from '../components/Pagination';
import { Button, ErrorBanner, Spinner } from '../components/ui';
import type { ProcedureFilter } from '../types';

/**
 * Page 1: filterable, sortable, paginated procedure list (UI-1, UI-4, UI-6).
 * Filter state lives in the URL search params via useProcedureListFilters,
 * so any selection is shareable.
 */
export function ProcedureListPage() {
  const { query, update, reset, toggleSort, hasActiveFilters } = useProcedureListFilters();
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const { data, isFetching, isError, error, refetch } = useProcedures(query);

  const items = data?.data ?? [];
  const pagination = data?.pagination;

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <FilterSidebar
        value={toFilter(query)}
        onChange={(patch) => update(patch)}
        onReset={reset}
        openOnMobile={mobileFiltersOpen}
        onCloseMobile={() => setMobileFiltersOpen(false)}
      />

      <div className="min-w-0 flex-1 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="font-display text-xl font-semibold text-slate-900">Procedimientos de contratación</h1>
            <p className="text-sm text-slate-500">
              {hasActiveFilters ? 'Resultados filtrados' : 'Explora licitaciones públicas de Compras MX'}
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            type="button"
            onClick={() => setMobileFiltersOpen((v) => !v)}
            className="lg:hidden"
          >
            {mobileFiltersOpen ? 'Cerrar filtros' : 'Filtros'}
          </Button>
        </div>

        {isError && (
          <ErrorBanner
            message={error instanceof Error ? error.message : 'Error al cargar los procedimientos.'}
            onRetry={() => void refetch()}
          />
        )}

        <div className="relative">
          {isFetching && !data && (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
              <Spinner className="h-5 w-5 text-institucional" /> Cargando procedimientos…
            </div>
          )}
          {data || !isFetching ? (
            <ProcedureTable
              items={items}
              loading={isFetching && !data}
              sort={query.sort}
              order={query.order}
              onSort={toggleSort}
            />
          ) : null}
        </div>

        {pagination && (
          <Pagination
            page={pagination.page}
            totalPages={pagination.total_pages}
            total={pagination.total}
            onPage={(p) => update({ page: p })}
          />
        )}
      </div>
    </div>
  );
}

/** Strip pagination/sort keys so the sidebar operates on filter-only state. */
function toFilter(q: import('../types').ProcedureListQuery): ProcedureFilter {
  const { page: _page, page_size: _ps, sort: _s, order: _o, ...filter } = q;
  return filter;
}
