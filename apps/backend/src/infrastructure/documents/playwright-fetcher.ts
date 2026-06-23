import { chromium, type Browser, type Page, type Response } from 'playwright';
import type { StorageInterface } from '../../domain/storage/storage-interface.js';
import type {
  DocFetcher,
  ExtractedDocument,
  FetchOutcome,
  FetchRequest,
} from '../../domain/documents/doc-fetcher.js';
import {
  extractAnexosFromBody,
  scrapeAnexosFromHtml,
  isAnexosEndpoint,
  isComprasApi,
  type RawAnexo,
} from './extract-anexos.js';

/**
 * PlaywrightDocFetcher — loads the ComprasMX Angular SPA, intercepts the anexos
 * API call the app makes automatically, extracts document metadata, and
 * best-effort downloads each file (#213).
 *
 * Why page-loading instead of a direct API call: the whitney API requires three
 * reCAPTCHA v3 + RSA-derived headers (`grc`/`igrc`/`xgrc`) that the Angular app
 * computes per-request via an HttpInterceptor. A direct call returns 403. By
 * loading the real page we let Angular handle auth and simply OBSERVE its
 * `expedientes/{uuid}/anexos` response (task spec: "intercept, don't call").
 *
 * reCAPTCHA handling (#213): headless Chromium may score poorly and get the
 * session blocked. We try headless first and, on a detected block, retry once
 * non-headless (configurable). Either way the outcome is graceful — never a
 * crash (DF-6).
 */
export interface PlaywrightFetcherOptions {
  storage: StorageInterface;
  /** Per-fetch wall-clock timeout (navigation + settle). */
  timeoutMs: number;
  /** Retry once non-headless when headless is reCAPTCHA-blocked. */
  headlessFallback: boolean;
  /** Realistic UA to reduce bot-detection scoring. */
  userAgent: string;
}

/** Outcome of a single browser attempt (before headless-fallback aggregation). */
interface AttemptResult {
  status: ExtractOutcomeStatus;
  documents: ExtractedDocument[];
  error?: string;
  mode: 'headless' | 'non-headless';
}

type ExtractOutcomeStatus = 'fetched' | 'captcha_blocked' | 'failed' | 'no_anexos';

const DEFAULT_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export class PlaywrightDocFetcher implements DocFetcher {
  private readonly opts: PlaywrightFetcherOptions;

  constructor(opts: Partial<PlaywrightFetcherOptions> & { storage: StorageInterface }) {
    this.opts = {
      timeoutMs: opts.timeoutMs ?? 30_000,
      headlessFallback: opts.headlessFallback ?? true,
      userAgent: opts.userAgent ?? DEFAULT_UA,
      storage: opts.storage,
    };
  }

  async fetch(req: FetchRequest): Promise<FetchOutcome> {
    // Attempt 1: headless (faster, less intrusive).
    let result = await this.attempt(req, true);

    // reCAPTCHA often blocks headless; retry once with a visible window (#213).
    if (result.status === 'captcha_blocked' && this.opts.headlessFallback) {
      const fallback = await this.attempt(req, false);
      if (fallback.status !== 'captcha_blocked') {
        result = fallback;
      }
    }
    return result;
  }

  private async attempt(req: FetchRequest, headless: boolean): Promise<AttemptResult> {
    const mode: 'headless' | 'non-headless' = headless ? 'headless' : 'non-headless';
    let browser: Browser | undefined;
    try {
      browser = await chromium.launch({ headless });
      const context = await browser.newContext({
        userAgent: this.opts.userAgent,
        locale: 'es-MX',
        viewport: { width: 1366, height: 900 },
      });
      const page = await context.newPage();

      // --- Intercept every response. We collect:                              ---
      //   * the anexos JSON body (the Angular app calls it on detail load)     ---
      //   * whether ANY ComprasMX API answered 403 (reCAPTCHA block signal)    ---
      let anexosBody: unknown = null;
      let anexosUrl: string | null = null;
      let anexosStatus: number | null = null;
      let sawComprasForbidden = false;

      const onResponse = async (response: Response) => {
        const url = response.url();
        try {
          if (response.status() === 403 && isComprasApi(url)) {
            sawComprasForbidden = true;
          }
          if (isAnexosEndpoint(url) && response.request().method() === 'GET') {
            anexosUrl = url;
            anexosStatus = response.status();
            if (response.ok()) {
              anexosBody = await this.safeJson(response);
            }
          }
        } catch {
          /* response may be gone; ignore */
        }
      };
      page.on('response', onResponse);

      // --- Navigate to the SPA detail URL (hash-routing aware) ---
      await page.goto(req.url, {
        waitUntil: 'domcontentloaded',
        timeout: this.opts.timeoutMs,
      });

      // Give the Angular bootstrap + reCAPTCHA + anexos call time to complete.
      await this.settle(page);

      // --- Decide outcome ---
      // 1) reCAPTCHA blocked the API → captcha_blocked (DF-6).
      if (sawComprasForbidden && anexosBody === null) {
        return {
          status: 'captcha_blocked',
          documents: [],
          error:
            'ComprasMX rechazó la solicitud (reCAPTCHA v3 / 403). No se pudieron obtener los anexos.',
          mode,
        };
      }

      // 2) Anexos intercepted successfully → extract + download.
      const rawFromApi =
        anexosBody !== null ? extractAnexosFromBody(anexosBody, anexosUrl ?? undefined) : [];

      // 3) Fallback: scrape the rendered DOM for document links.
      let rawFromDom: RawAnexo[] = [];
      if (rawFromApi.length === 0) {
        const html = await page.content();
        rawFromDom = scrapeAnexosFromHtml(html, req.url);
      }

      const raw = rawFromApi.length > 0 ? rawFromApi : rawFromDom;

      if (raw.length === 0) {
        // Page loaded cleanly but exposed no documents.
        return {
          status: 'no_anexos',
          documents: [],
          error: 'El anuncio cargó pero no expone documentos descargables.',
          mode,
        };
      }

      // 4) Best-effort download each anexo within the browser's auth context.
      const documents = await this.downloadAll(page, req.procedureId, raw);

      return { status: 'fetched', documents, mode };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // A navigation/timeout before seeing anything → treat as failed (not captcha).
      const isTimeout = /timeout|timed out/i.test(message);
      return {
        status: 'failed',
        documents: [],
        error: isTimeout
          ? `Tiempo de espera agotado al cargar el anuncio (${this.opts.timeoutMs}ms).`
          : `Error al cargar el anuncio: ${message}`,
        mode,
      };
    } finally {
      await browser?.close().catch(() => undefined);
    }
  }

  /**
   * Wait for the Angular SPA to bootstrap and fire its API calls. We wait for
   * networkidle when possible, then a short fixed settle for late reCAPTCHA.
   */
  private async settle(page: Page): Promise<void> {
    try {
      await page.waitForLoadState('networkidle', { timeout: this.opts.timeoutMs });
    } catch {
      // networkidle may never fire if the page polls; fall through to the delay.
    }
    // Extra settle for reCAPTCHA v3 scoring + late anexos call.
    await page.waitForTimeout(2500).catch(() => undefined);
  }

  /** Parse JSON defensively (response may be empty / non-JSON on a block). */
  private async safeJson(response: Response): Promise<unknown> {
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

  /**
   * Download every anexo through the page's browser context so the request
   * carries the same cookies/origin the Angular app established. NOTE: the
   * `grc`/`igrc`/`xgrc` headers are injected by an Angular HttpInterceptor, NOT
   * by the browser, so a raw context request MAY still 403. We treat download
   * failure as per-file partial (DF-8): metadata is persisted regardless.
   */
  private async downloadAll(
    page: Page,
    procedureId: number,
    raw: RawAnexo[],
  ): Promise<ExtractedDocument[]> {
    const out: ExtractedDocument[] = [];
    for (const anexo of raw) {
      const doc: ExtractedDocument = {
        titulo: anexo.titulo,
        tipo: anexo.tipo,
        urlFuente: anexo.urlFuente,
        archivoLocal: null,
        storageRef: null,
        estatus: 'fetched',
      };

      if (anexo.downloadUrl) {
        try {
          const res = await page.context().request.get(anexo.downloadUrl, {
            timeout: Math.min(15_000, this.opts.timeoutMs),
          });
          if (res.ok()) {
            const buf = Buffer.from(await res.body());
            const filename = this.sanitizeFilename(anexo);
            const stored = await this.opts.storage.save(procedureId, filename, buf);
            doc.archivoLocal = filename;
            doc.storageRef = stored.storageRef;
          } else {
            // Likely 403 (reCAPTCHA on the file endpoint). Keep metadata only.
            doc.estatus = 'failed';
            doc.error = `Descarga HTTP ${res.status()}`;
          }
        } catch (err) {
          doc.estatus = 'failed';
          doc.error = err instanceof Error ? err.message : 'descarga fallida';
        }
      }

      out.push(doc);
    }
    return out;
  }

  /** Build a safe local filename from an anexo's title/extension. */
  private sanitizeFilename(anexo: RawAnexo): string {
    const ext = anexo.tipo && /^[A-Z0-9]{2,4}$/.test(anexo.tipo) ? `.${anexo.tipo.toLowerCase()}` : '';
    const base = anexo.titulo
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // strip accents
      .replace(/[^a-zA-Z0-9-_ ]/g, '')
      .trim()
      .replace(/\s+/g, '_')
      .slice(0, 80);
    const suffix = ext || '.bin';
    return base ? `${base}${suffix}` : `documento${suffix}`;
  }
}
