import type { ApiErrorBody } from '../types';

/** Base path for every backend call. The Vite dev server proxies `/api` → :3000. */
export const API_BASE = '/api';

/** Error thrown for non-2xx API responses. Carries the parsed body when available. */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody | undefined;

  constructor(status: number, body: ApiErrorBody | undefined, message?: string) {
    super(message ?? `API request failed: ${status}`);
    this.name = 'ApiRequestError';
    this.status = status;
    this.body = body;
  }

  /** Human-readable message suitable for display in error states. */
  get displayMessage(): string {
    if (this.status === 404) return 'No se encontró el recurso solicitado.';
    if (this.status === 400 && this.body?.issues?.length) {
      return `Filtro inválido: ${this.body.issues.map((i) => i.message).join('; ')}`;
    }
    return this.body?.message ?? 'Ocurrió un error al consultar el servidor.';
  }
}

interface RequestOptions {
  signal?: AbortSignal;
}

/**
 * Fetch wrapper. Parses JSON, normalizes errors into ApiRequestError, and
 * preserves the response shape (callers specify the expected type).
 */
export async function apiGet<T>(path: string, query?: Record<string, unknown>, opts?: RequestOptions): Promise<T> {
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      if (Array.isArray(value)) {
        for (const v of value) url.searchParams.append(key, String(v));
      } else {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'include',
    signal: opts?.signal,
  });

  const text = await res.text();
  const body = text ? (safeParse(text) as unknown) : undefined;

  if (!res.ok) {
    throw new ApiRequestError(res.status, body as ApiErrorBody | undefined);
  }
  return body as T;
}

/** Shared implementation for POST/PATCH/DELETE — JSON body, cookies included
 * (the admin session lives in an httpOnly cookie). */
async function apiMutate<T>(
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  jsonBody?: unknown,
  opts?: RequestOptions,
): Promise<T> {
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  const res = await fetch(url, {
    method,
    headers: {
      Accept: 'application/json',
      ...(jsonBody !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    credentials: 'include',
    body: jsonBody !== undefined ? JSON.stringify(jsonBody) : undefined,
    signal: opts?.signal,
  });

  const text = await res.text();
  const body = text ? (safeParse(text) as unknown) : undefined;

  if (!res.ok) {
    throw new ApiRequestError(res.status, body as ApiErrorBody | undefined);
  }
  return body as T;
}

/** POST wrapper. `jsonBody` is optional (most existing callers are trigger-only). */
export function apiPost<T>(path: string, jsonBody?: unknown, opts?: RequestOptions): Promise<T> {
  return apiMutate<T>('POST', path, jsonBody, opts);
}

export function apiPatch<T>(path: string, jsonBody?: unknown, opts?: RequestOptions): Promise<T> {
  return apiMutate<T>('PATCH', path, jsonBody, opts);
}

export function apiDelete<T>(path: string, opts?: RequestOptions): Promise<T> {
  return apiMutate<T>('DELETE', path, undefined, opts);
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
