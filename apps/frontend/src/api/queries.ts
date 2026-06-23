import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { apiGet } from './client';
import type {
  AnalyticsSummary,
  InstitucionGroup,
  ProcedureDetail,
  ProcedureFilter,
  ProcedureListPage,
  ProcedureListQuery,
  SupplierGroup,
  TipoContratacionResult,
} from '../types';

/** Strip undefined/empty values so the URL stays clean and cache keys stay stable. */
function prune(filter: ProcedureFilter): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(filter)) {
    if (v === undefined || v === null || v === '' || Number.isNaN(v)) continue;
    out[k] = v;
  }
  return out;
}

// --- Procedure list ---

export function useProcedures(query: ProcedureListQuery) {
  const { page, page_size, sort, order, ...filter } = query;
  return useQuery({
    queryKey: ['procedures', query],
    queryFn: ({ signal }) =>
      apiGet<ProcedureListPage>('/procedures', {
        ...prune(filter),
        page,
        page_size,
        sort,
        order,
      }),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

// --- Procedure detail ---

export function useProcedureDetail(numeroProcedimiento: string | undefined) {
  return useQuery({
    queryKey: ['procedure', numeroProcedimiento],
    queryFn: ({ signal }) => {
      if (!numeroProcedimiento) throw new Error('Missing numero_procedimiento');
      return apiGet<ProcedureDetail>(`/procedures/${encodeURIComponent(numeroProcedimiento)}`, undefined, { signal });
    },
    enabled: Boolean(numeroProcedimiento),
  });
}

// --- Analytics ---

export function useAnalyticsSummary(filter: ProcedureFilter) {
  return useQuery({
    queryKey: ['analytics', 'summary', filter],
    queryFn: ({ signal }) => apiGet<AnalyticsSummary>('/analytics/summary', prune(filter), { signal }),
    staleTime: 60_000,
  });
}

export function useAnalyticsByInstitucion(filter: ProcedureFilter, limit = 10) {
  return useQuery({
    queryKey: ['analytics', 'by-institucion', filter, limit],
    queryFn: ({ signal }) =>
      apiGet<{ data: InstitucionGroup[] }>('/analytics/by-institucion', { ...prune(filter), limit }, { signal }),
    staleTime: 60_000,
  });
}

export function useAnalyticsByTipoContratacion(filter: ProcedureFilter) {
  return useQuery({
    queryKey: ['analytics', 'by-tipo-contratacion', filter],
    queryFn: ({ signal }) => apiGet<TipoContratacionResult>('/analytics/by-tipo-contratacion', prune(filter), { signal }),
    staleTime: 60_000,
  });
}

export function useAnalyticsTopProveedores(filter: ProcedureFilter, limit = 10) {
  return useQuery({
    queryKey: ['analytics', 'top-proveedores', filter, limit],
    queryFn: ({ signal }) =>
      apiGet<{ data: SupplierGroup[] }>('/analytics/top-proveedores', { ...prune(filter), limit }, { signal }),
    staleTime: 60_000,
  });
}
