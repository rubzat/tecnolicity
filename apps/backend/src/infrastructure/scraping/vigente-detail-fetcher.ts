import { chromium, type Browser, type Response } from 'playwright';
import { isComprasApi } from '../documents/extract-anexos.js';

/**
 * VigenteDetailFetcher (PR8) — loads the ComprasMX detail SPA page for ONE
 * vigente procedure and intercepts the 3 API responses the Angular app fires
 * automatically on load (#213/#231):
 *
 *   POST whitney/sitiopublico/expedientes/{uuid}?id_proceso={n}        → detalle
 *   POST whitney/sitiopublico/expedientes/{uuid}/anexos?id_proceso={n} → anexos
 *   POST whitney/sitiopublico/expedientes/{uuid}/reqeconomicos?id_proceso={n}
 *
 * Why page-loading instead of a direct API call: every whitney request needs
 * the reCAPTCHA v3 + RSA-derived headers (`grc`/`igrc`/`xgrc`) the Angular
 * HttpInterceptor computes per-request. A direct call returns 403 (#213). By
 * loading the real detail page we let Angular handle auth AND resolve the real
 * `id_proceso` (the search response carries 0; the SPA looks up the real one),
 * while we simply OBSERVE the responses it makes.
 *
 * This mirrors the proven PR4 pattern (playwright-fetcher.ts) and PR7 browser
 * config (vigente-scraper.ts). reCAPTCHA does NOT block headless Chromium here
 * (confirmed in PR4/PR7); we still fail gracefully if a 403 appears.
 */

export interface VigenteDetailPayload {
  /** RAW `detalleProcedimiento` response body, or null if the call didn't fire. */
  detalle: unknown | null;
  /** RAW `anexos` response body, or null. */
  anexos: unknown | null;
  /** RAW `reqeconomicos` response body, or null. */
  reqeconomicos: unknown | null;
}

export interface VigenteDetailResult extends VigenteDetailPayload {
  /** True when a ComprasMX API answered 403 (reCAPTCHA block signal, #213). */
  blocked: boolean;
  /** Non-fatal error message (timeout / crash) when the page load failed. */
  error?: string;
}

export interface VigenteDetailFetcherOptions {
  /** Per-fetch wall-clock timeout (navigation + settle). */
  timeoutMs: number;
  /** Realistic UA to reduce bot-detection scoring. */
  userAgent: string;
}

type DetailKind = 'detalle' | 'anexos' | 'reqeconomicos';

const DEFAULT_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** Escape a string for safe embedding inside a RegExp. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Classify a response URL into one of the 3 detail endpoints.
 *
 * The detail `expedientes/{uuid}?` call must be told apart from its
 * `/anexos` and `/reqeconomicos` siblings, and from the bare search
 * (`expedientes?rows=&page=`, which has no path segment after `expedientes`).
 *
 * Matching is method-agnostic: `page.on('response')` fires for BOTH GET and
 * POST, and the ComprasMX detail endpoints are POST (#231) — so we match by
 * URL path shape, never by method.
 */
function classifyUrl(url: string, uuid: string | null): DetailKind | null {
  // Only consider whitney/sitiopublico expedientes calls.
  if (!/whitney\/sitiopublico/i.test(url) || !/\/expedientes/i.test(url)) {
    return null;
  }
  if (/\/reqeconomicos(\?|$|#|\/)/i.test(url)) return 'reqeconomicos';
  if (/\/anexos(\?|$|#|\/)/i.test(url)) return 'anexos';

  // Detalle: `expedientes/{segment}?` — i.e. there IS a path segment between
  // `expedientes` and the query string (the bare search has none).
  if (uuid) {
    // Pin to THIS procedure's uuid so two open tabs can't cross-capture.
    const re = new RegExp(`/expedientes/${escapeRe(uuid)}(\\?|$|#)`, 'i');
    return re.test(url) ? 'detalle' : null;
  }
  // Fallback (uuid missing): accept any hex-ish uuid segment.
  return /\/expedientes\/[0-9a-f]{16,}(\?|$|#)/i.test(url) ? 'detalle' : null;
}

export class VigenteDetailFetcher {
  private readonly opts: Required<VigenteDetailFetcherOptions>;

  constructor(opts: Partial<VigenteDetailFetcherOptions> = {}) {
    this.opts = {
      timeoutMs: opts.timeoutMs ?? 30_000,
      userAgent: opts.userAgent ?? DEFAULT_UA,
    };
  }

  /**
   * Load the ComprasMX detail page for a procedure and intercept its API calls.
   *
   * @param detailUrl  the `direcciones_anuncio` hash-routing SPA URL.
   * @param uuid       the procedure's SPA uuid (tightens response matching).
   * @returns the 3 intercepted bodies (any may be null) + status flags.
   */
  async fetchDetail(detailUrl: string, uuid: string | null): Promise<VigenteDetailResult> {
    let browser: Browser | undefined;
    try {
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({
        userAgent: this.opts.userAgent,
        locale: 'es-MX',
        viewport: { width: 1366, height: 900 },
      });
      const page = await context.newPage();

      let detalle: unknown | null = null;
      let anexos: unknown | null = null;
      let reqeconomicos: unknown | null = null;
      let sawForbidden = false;

      const onResponse = async (response: Response) => {
        const url = response.url();
        try {
          if (response.status() === 403 && isComprasApi(url)) {
            sawForbidden = true;
          }
          if (!response.ok()) return;
          const kind = classifyUrl(url, uuid);
          if (!kind) return;
          const body = await this.safeJson(response);
          if (body === null) return;
          // First non-null body wins; ignore duplicates/retries the SPA may fire.
          if (kind === 'detalle' && detalle === null) detalle = body;
          else if (kind === 'anexos' && anexos === null) anexos = body;
          else if (kind === 'reqeconomicos' && reqeconomicos === null) reqeconomicos = body;
        } catch {
          /* response may already be disposed; ignore */
        }
      };
      page.on('response', onResponse);

      // Navigate to the hash-routing SPA detail URL (Angular reads the # fragment).
      await page.goto(detailUrl, {
        waitUntil: 'domcontentloaded',
        timeout: this.opts.timeoutMs,
      });

      // Let the Angular bootstrap + reCAPTCHA + 3 API calls complete.
      await this.settle(page);

      return {
        detalle,
        anexos,
        reqeconomicos,
        blocked: sawForbidden && detalle === null,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isTimeout = /timeout|timed out/i.test(message);
      return {
        detalle: null,
        anexos: null,
        reqeconomicos: null,
        blocked: false,
        error: isTimeout
          ? `Tiempo de espera agotado al cargar el detalle (${this.opts.timeoutMs}ms).`
          : `Error al cargar el detalle: ${message}`,
      };
    } finally {
      await browser?.close().catch(() => undefined);
    }
  }

  /** Wait for the Angular SPA to bootstrap and fire its API calls. */
  private async settle(page: import('playwright').Page): Promise<void> {
    try {
      await page.waitForLoadState('networkidle', { timeout: this.opts.timeoutMs });
    } catch {
      /* networkidle may never fire if the page polls; fall through */
    }
    // Extra settle for reCAPTCHA v3 scoring + late detalle/anexos/req calls.
    await page.waitForTimeout(2500).catch(() => undefined);
  }

  /** Parse JSON defensively (response may be empty / non-JSON on a block). */
  private async safeJson(response: Response): Promise<unknown | null> {
    try {
      return await response.json();
    } catch {
      try {
        const text = await response.text();
        return text ? JSON.parse(text) : null;
      } catch {
        return null;
      }
    }
  }
}
