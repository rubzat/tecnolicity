import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPatch, apiDelete } from './client';
import type { AdminSession, ApiKeySummary, ApiKeyCreated } from '../types';

/** Session probe — powers the /admin route guard. Never throws on 401/etc:
 * the backend always answers 200 with `authenticated: false/true`. */
export function useAdminSession() {
  return useQuery({
    queryKey: ['admin', 'session'],
    queryFn: ({ signal }) => apiGet<AdminSession>('/admin/me', undefined, { signal }),
    retry: false,
    staleTime: 0,
  });
}

export function useAdminLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (creds: { username: string; password: string }) =>
      apiPost<{ status: string }>('/admin/login', creds),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'session'] });
    },
  });
}

export function useAdminLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost<{ status: string }>('/admin/logout'),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'session'] });
    },
  });
}

export function useApiKeys() {
  return useQuery({
    queryKey: ['admin', 'api-keys'],
    queryFn: ({ signal }) => apiGet<{ data: ApiKeySummary[] }>('/admin/api-keys', undefined, { signal }),
  });
}

export function useCreateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; email?: string; rate_limit_per_minute?: number }) =>
      apiPost<ApiKeyCreated>('/admin/api-keys', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'api-keys'] });
    },
  });
}

export function useUpdateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: number; active?: boolean; rate_limit_per_minute?: number }) =>
      apiPatch<ApiKeySummary>(`/admin/api-keys/${id}`, patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'api-keys'] });
    },
  });
}

export function useDeleteApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiDelete<void>(`/admin/api-keys/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'api-keys'] });
    },
  });
}
