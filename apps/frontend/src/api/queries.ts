import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { apiGet, apiPost } from './client';
import type {
  AnalyticsSummary,
  DocumentItem,
  FetchDocumentsResponse,
  InstitucionGroup,
  MarketBuyer,
  MarketCompetitor,
  MarketDominance,
  MarketExpiringContract,
  MarketOpportunity,
  MarketOverview,
  ProcedureDetail,
  ProcedureFilter,
  ProcedureListPage,
  ProcedureListQuery,
  ScrapeVigentesSummary,
  SupplierGroup,
  TipoContratacionResult,
  VigenteItem,
  VigenteListPage,
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

// --- Market Intelligence (PR6) ---
// Every hook depends on the active keyword list (`segment`). When the list is
// empty the hooks stay disabled so no request fires until the user hits
// "Analizar". The keywords are joined into a single comma-separated `segment`
// param (the backend parses + falls back to defaults when absent).

function segmentParam(keywords: string[]): { segment: string } {
  return { segment: keywords.join(',') };
}

export function useMarketOverview(keywords: string[], enabled: boolean) {
  return useQuery({
    queryKey: ['market', 'overview', keywords],
    queryFn: ({ signal }) =>
      apiGet<MarketOverview>('/market/overview', segmentParam(keywords), { signal }),
    enabled: enabled && keywords.length > 0,
    staleTime: 60_000,
  });
}

export function useMarketCompetitors(keywords: string[], enabled: boolean, limit = 10) {
  return useQuery({
    queryKey: ['market', 'competitors', keywords, limit],
    queryFn: ({ signal }) =>
      apiGet<{ data: MarketCompetitor[] }>(
        '/market/competitors',
        { ...segmentParam(keywords), limit },
        { signal },
      ),
    enabled: enabled && keywords.length > 0,
    staleTime: 60_000,
  });
}

export function useMarketBuyers(keywords: string[], enabled: boolean, limit = 10) {
  return useQuery({
    queryKey: ['market', 'buyers', keywords, limit],
    queryFn: ({ signal }) =>
      apiGet<{ data: MarketBuyer[] }>(
        '/market/buyers',
        { ...segmentParam(keywords), limit },
        { signal },
      ),
    enabled: enabled && keywords.length > 0,
    staleTime: 60_000,
  });
}

export function useMarketOpportunities(
  keywords: string[],
  enabled: boolean,
  page: number,
  limit = 20,
) {
  return useQuery({
    queryKey: ['market', 'opportunities', keywords, page, limit],
    queryFn: ({ signal }) =>
      apiGet<{ data: MarketOpportunity[]; pagination: { total: number; total_pages: number } }>(
        '/market/opportunities',
        { ...segmentParam(keywords), page, limit },
        { signal },
      ),
    enabled: enabled && keywords.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

export function useMarketExpiring(keywords: string[], enabled: boolean, months = 6, limit = 20) {
  return useQuery({
    queryKey: ['market', 'expiring', keywords, months, limit],
    queryFn: ({ signal }) =>
      apiGet<{ data: MarketExpiringContract[] }>(
        '/market/expiring',
        { ...segmentParam(keywords), months, limit },
        { signal },
      ),
    enabled: enabled && keywords.length > 0,
    staleTime: 60_000,
  });
}

export function useMarketDominance(keywords: string[], enabled: boolean, limit = 10) {
  return useQuery({
    queryKey: ['market', 'dominance', keywords, limit],
    queryFn: ({ signal }) =>
      apiGet<{ data: MarketDominance[] }>(
        '/market/dominance',
        { ...segmentParam(keywords), limit },
        { signal },
      ),
    enabled: enabled && keywords.length > 0,
    staleTime: 60_000,
  });
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

// --- Documents (Phase 5) ---

/** Cached documents for a procedure (DF-1 read). Empty array when not fetched. */
export function useDocuments(numeroProcedimiento: string | undefined) {
  return useQuery({
    queryKey: ['documents', numeroProcedimiento],
    queryFn: ({ signal }) => {
      if (!numeroProcedimiento) throw new Error('Missing numero_procedimiento');
      return apiGet<{ data: DocumentItem[] }>(
        `/procedures/${encodeURIComponent(numeroProcedimiento)}/documents`,
        undefined,
        { signal },
      );
    },
    enabled: Boolean(numeroProcedimiento),
  });
}

/** On-demand fetch trigger (POST /documents/fetch). Cache-first on the server. */
export function useFetchDocuments(numeroProcedimiento: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => {
      if (!numeroProcedimiento) throw new Error('Missing numero_procedimiento');
      return apiPost<FetchDocumentsResponse>(
        `/procedures/${encodeURIComponent(numeroProcedimiento)}/documents/fetch`,
      );
    },
    // The response already carries the freshly-stored rows → write them straight
    // into the documents cache (no extra refetch round-trip, no list flash).
    onSuccess: (data) => {
      if (numeroProcedimiento) {
        qc.setQueryData(['documents', numeroProcedimiento], { data: data.documents });
      }
    },
  });
}

// --- Vigente procedures (PR7: currently-open bids) ---

export interface VigenteListQuery {
  page: number;
  page_size: number;
  tipo_contratacion?: string;
  tipo_procedimiento?: string;
  dependencia?: string;
  siglas?: string;
  entidad_federativa?: string;
  q?: string;
}

export function useVigentes(query: VigenteListQuery) {
  return useQuery({
    queryKey: ['vigentes', query],
    queryFn: ({ signal }) => apiGet<VigenteListPage>('/vigentes', pruneVigente(query), { signal }),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

/** On-demand scrape trigger (POST /vigentes/scrape). Invalidates the list on success. */
export function useScrapeVigentes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost<ScrapeVigentesSummary>('/vigentes/scrape'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vigentes'] });
    },
  });
}

/** Count of currently-open procedures (for the summary card). Reuses the list endpoint at page 1. */
export function useVigentesCount(enabled = true) {
  return useQuery({
    queryKey: ['vigentes', 'count'],
    queryFn: ({ signal }) => apiGet<VigenteListPage>('/vigentes', { page: 1, page_size: 1 }, { signal }),
    select: (page) => page.pagination.total,
    enabled,
    staleTime: 60_000,
  });
}

function pruneVigente(q: VigenteListQuery): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null || v === '' || Number.isNaN(v)) continue;
    out[k] = v;
  }
  return out;
}

// Re-exported so callers can type vigente rows without importing types/index.
export type { VigenteItem };
