import type {
  VigenteRepository,
  VigenteDetalleCache,
} from '../../domain/repositories/vigente-repository.js';
import type { VigenteDetailFetcher } from '../../infrastructure/scraping/vigente-detail-fetcher.js';

/**
 * Use case: fetch the full detail of ONE vigente procedure on demand,
 * cache-first (PR8).
 *
 * Flow:
 *  1. Resolve the procedure (→ null = 404 at the route).
 *  2. Cache hit (detalle_json present AND fetched_at within TTL) → return cached
 *     WITHOUT launching Playwright (instant).
 *  3. Cache miss / stale → run the VigenteDetailFetcher (Playwright loads the
 *     detail SPA, intercepts detalle+anexos+reqeconomicos, ~8-15s), persist the
 *     result, and return it.
 *
 * reCAPTCHA (#213): a `captcha_blocked` outcome is returned gracefully (HTTP
 * 200, not 500) — it's an EXPECTED operational result for headless Chromium.
 * It does NOT overwrite a previously-good cache, so a transient block never
 * destroys known-good data.
 *
 * Timeout: the fetcher has its own internal timeout; this use case wraps the
 * whole fetch in a wall-clock budget. If it elapses we return `timeout` while
 * the in-flight browser keeps running and persists when it finishes, so a later
 * call still sees the result.
 *
 * Partial data: the SPA may legitimately omit one of the 3 calls (e.g. a
 * procedure with no economic requirements). Whatever WAS intercepted is
 * persisted and served; the missing field stays null.
 */
export type FetchVigenteDetailStatus =
  | 'cached' // served from cache, Playwright not launched
  | 'fetched' // fresh fetch completed (may have partial bodies)
  | 'captcha_blocked' // reCAPTCHA refused the session (#213)
  | 'failed' // page loaded but no detail intercepted / crashed
  | 'timeout' // wall-clock budget elapsed
  | 'no_anuncio_url' // procedure has no direccion_anuncio
  | 'stale_failed'; // fetch failed but a (stale) cache exists → serve cache

export interface FetchVigenteDetailResult {
  status: FetchVigenteDetailStatus;
  detalle: unknown | null;
  anexos: unknown | null;
  reqeconomicos: unknown | null;
  /** ISO timestamp of the last successful cache population (null = never). */
  detalleFetchedAt: string | null;
  message?: string;
}

export interface FetchVigenteDetailDeps {
  repository: Pick<VigenteRepository, 'getByNumero' | 'getDetalle' | 'updateDetalle'>;
  fetcher: Pick<VigenteDetailFetcher, 'fetchDetail'>;
  /** Cache time-to-live (VIGENTE_DETAIL_CACHE_TTL_MS). */
  cacheTtlMs: number;
  /** Wall-clock budget for the Playwright fetch (SCRAPER_TIMEOUT_MS). */
  timeoutMs: number;
}

/** Marker error used only to detect the timeout race. */
class FetchTimeoutMarker extends Error {
  constructor() {
    super('vigente detail fetch timeout');
    this.name = 'FetchTimeoutMarker';
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let handle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    handle = setTimeout(() => reject(new FetchTimeoutMarker()), ms);
  });
  return Promise.race([p.finally(() => clearTimeout(handle)), timeout]);
}

/** Shape a cache row into the wire result. */
function fromCache(
  status: FetchVigenteDetailStatus,
  cache: VigenteDetalleCache,
  message?: string,
): FetchVigenteDetailResult {
  return {
    status,
    detalle: cache.detalleJson,
    anexos: cache.anexosJson,
    reqeconomicos: cache.reqeconomicosJson,
    detalleFetchedAt: cache.detalleFetchedAt ? cache.detalleFetchedAt.toISOString() : null,
    ...(message ? { message } : {}),
  };
}

export class FetchVigenteDetail {
  constructor(private readonly deps: FetchVigenteDetailDeps) {}

  /**
   * Drive a detail fetch for `numeroProcedimiento`. Returns null when the
   * procedure itself is unknown (route answers 404).
   */
  async execute(numeroProcedimiento: string): Promise<FetchVigenteDetailResult | null> {
    const proc = await this.deps.repository.getByNumero(numeroProcedimiento);
    if (!proc) return null;

    // --- Cache-first: a fresh successful detalle is served immediately ---
    const cache = await this.deps.repository.getDetalle(numeroProcedimiento);
    if (cache?.detalleJson && cache.detalleFetchedAt) {
      const age = Date.now() - cache.detalleFetchedAt.getTime();
      if (age < this.deps.cacheTtlMs) {
        return fromCache('cached', cache);
      }
    }

    // No usable detail URL → can't fetch.
    if (!proc.direccionesAnuncio) {
      return {
        status: 'no_anuncio_url',
        detalle: cache?.detalleJson ?? null,
        anexos: cache?.anexosJson ?? null,
        reqeconomicos: cache?.reqeconomicosJson ?? null,
        detalleFetchedAt: cache?.detalleFetchedAt ? cache.detalleFetchedAt.toISOString() : null,
        message: 'Este procedimiento no tiene dirección de anuncio registrada.',
      };
    }

    // --- Cache miss / stale → run Playwright with a wall-clock budget ---
    const task = () =>
      this.deps.fetcher.fetchDetail(proc.direccionesAnuncio!, proc.uuidProcedimiento);

    let result;
    try {
      result = await withTimeout(task(), this.deps.timeoutMs);
    } catch (err) {
      if (err instanceof FetchTimeoutMarker) {
        // In-flight browser may still persist later; serve what we have.
        return cache?.detalleJson
          ? fromCache(
              'stale_failed',
              cache,
              `La carga del detalle superó el tiempo máximo (${this.deps.timeoutMs}ms). Mostrando datos en caché.`,
            )
          : {
              status: 'timeout',
              detalle: null,
              anexos: null,
              reqeconomicos: null,
              detalleFetchedAt: null,
              message: `La carga del detalle superó el tiempo máximo (${this.deps.timeoutMs}ms). Intentá nuevamente.`,
            };
      }
      throw err;
    }

    // reCAPTCHA block → do NOT overwrite a good cache; serve it if present.
    if (result.blocked) {
      if (cache?.detalleJson) {
        return fromCache(
          'stale_failed',
          cache,
          'ComprasMX rechazó la solicitud (reCAPTCHA v3 / 403). Mostrando datos en caché.',
        );
      }
      return {
        status: 'captcha_blocked',
        detalle: null,
        anexos: null,
        reqeconomicos: null,
        detalleFetchedAt: null,
        message:
          'ComprasMX rechazó la solicitud (reCAPTCHA v3 / 403). No se pudo obtener el detalle.',
      };
    }

    // Nothing intercepted → failed (but keep any prior cache, don't persist nulls).
    if (result.detalle === null && result.anexos === null && result.reqeconomicos === null) {
      if (cache?.detalleJson) {
        return fromCache('stale_failed', cache, result.error ?? 'No se obtuvo respuesta del detalle.');
      }
      return {
        status: 'failed',
        detalle: null,
        anexos: null,
        reqeconomicos: null,
        detalleFetchedAt: null,
        message: result.error ?? 'No se obtuvo respuesta del detalle desde ComprasMX.',
      };
    }

    // Persist whatever we intercepted (partial data is fine) + serve it fresh.
    await this.deps.repository.updateDetalle(
      numeroProcedimiento,
      result.detalle,
      result.anexos,
      result.reqeconomicos,
    );

    return {
      status: 'fetched',
      detalle: result.detalle,
      anexos: result.anexos,
      reqeconomicos: result.reqeconomicos,
      detalleFetchedAt: new Date().toISOString(),
    };
  }
}
