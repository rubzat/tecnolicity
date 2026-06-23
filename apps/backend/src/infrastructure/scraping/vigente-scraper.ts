import { chromium, type Browser, type Response } from 'playwright';
import {
  parseSearchResponse,
  VIGENTE_FILTER_BODY,
  type ParsedVigentePage,
} from './parse-vigente.js';
import type { UpsertVigenteInput } from '../../domain/repositories/vigente-repository.js';

/**
 * VigenteScraper — loads the ComprasMX Angular SPA, lets the app fire its
 * "Anuncios vigentes" search, and intercepts the POST response (it can't be
 * called directly — every request needs the reCAPTCHA+RSA-derived
 * `grc`/`igrc`/`xgrc` headers the Angular HttpInterceptor computes, #213).
 *
 * Strategy (#231 verified contract):
 *  1. Navigate to the search route (`#/`) so Angular bootstraps + fires the
 *     initial `expedientes?rows=&page=` POST for the default vigentes tab.
 *  2. Intercept that response; parse registros + pagination.
 *  3. To fetch the OTHER pages we don't drive the SPA paginator (slow + flaky);
 *     instead we RE-POST the search from inside the page's own context using
 *     `page.evaluate` + fetch. Running inside the page means the request still
 *     originates from the SPA origin and goes through the same HttpInterceptor
 *     ... BUT that interceptor only decorates HttpClient calls, not raw fetch.
 *     So instead we simply re-trigger the SPA's paginator by advancing
 *     `page` — the cleanest reliable path is to reload with each page by
 *     clicking the paginator's "next" control, OR (preferred, used here) call
 *     the SPA's search again by clearing+setting page via the table component.
 *
 *     PRAGMATIC CHOICE: drive the PrimeNG paginator buttons (`.p-paginator-
 *     next` / page links). This re-fires the POST through Angular's real
 *     HttpClient, so grc/igrc/xgrc are attached. We capture each response.
 *
 * reCAPTCHA: headless Chromium is NOT blocked by reCAPTCHA v3 on this site
 * (confirmed in PR4). We still fail gracefully if a 403 appears.
 */

const SEARCH_URL = 'https://comprasmx.buengobierno.gob.mx/sitiopublico/#/';
const EXP_RE = /\/expedientes\?/i;
const WHITNEY_RE = /whitney\/sitiopublico/i;
const DEFAULT_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export interface ScraperProgress {
  page: number;
  registros: number;
  totalReported: number | null;
}

export interface VigenteScraperOptions {
  /** Per-page navigation + settle timeout (ms). */
  timeoutMs: number;
  /** Delay between page loads — don't hammer the government source. */
  delayMs: number;
  /** Hard cap on how many result pages to fetch. */
  maxPages: number;
  /** Page size requested from the API (max observed working = 100). */
  pageSize: number;
  /** Realistic UA to reduce bot-detection scoring. */
  userAgent: string;
}

export interface ScrapeResult {
  registros: UpsertVigenteInput[];
  totalReported: number | null;
  pagesScraped: number;
  /** True if reCAPTCHA/403 blocked the API before any data came back. */
  blocked: boolean;
  error?: string;
}

export class VigenteScraper {
  private readonly opts: Required<VigenteScraperOptions>;

  constructor(opts: Partial<VigenteScraperOptions> = {}) {
    this.opts = {
      timeoutMs: opts.timeoutMs ?? 45_000,
      delayMs: opts.delayMs ?? 2000,
      maxPages: opts.maxPages ?? 50,
      pageSize: opts.pageSize ?? 100,
      userAgent: opts.userAgent ?? DEFAULT_UA,
    };
  }

  /**
   * Scrape ALL vigente pages (up to maxPages), invoking `onProgress` per page.
   * Returns the merged, dedup-by-numero list of normalized upsert inputs.
   */
  async scrape(onProgress?: (p: ScraperProgress) => void): Promise<ScrapeResult> {
    let browser: Browser | undefined;
    try {
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({
        userAgent: this.opts.userAgent,
        locale: 'es-MX',
        viewport: { width: 1366, height: 900 },
      });
      const page = await context.newPage();

      // Intercept every expedientes search response.
      let latest: ParsedVigentePage = { registros: [], pagination: null };
      let sawForbidden = false;
      page.on('response', async (response: Response) => {
        const url = response.url();
        if (!EXP_RE.test(url) || !WHITNEY_RE.test(url)) return;
        if (response.status() === 403) {
          sawForbidden = true;
          return;
        }
        try {
          if (response.ok() && response.request().method() === 'POST') {
            const json = await response.json();
            latest = parseSearchResponse(json);
          }
        } catch {
          /* body already consumed or gone */
        }
      });

      // --- Page 1: load the SPA, let the default vigentes search fire ---
      await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: this.opts.timeoutMs });
      await this.settle(page);

      if (latest.registros.length === 0) {
        // Give the search one more chance (reCAPTCHA scoring can delay it).
        await page.waitForTimeout(3000);
      }

      if (sawForbidden && latest.registros.length === 0) {
        return {
          registros: [],
          totalReported: null,
          pagesScraped: 0,
          blocked: true,
          error:
            'ComprasMX rechazó la solicitud (reCAPTCHA v3 / 403). No se pudieron obtener los procedimientos vigentes.',
        };
      }

      if (latest.registros.length === 0) {
        return {
          registros: [],
          totalReported: null,
          pagesScraped: 0,
          blocked: false,
          error: 'La búsqueda de vigentes no devolvió registros.',
        };
      }

      const totalReported = latest.pagination?.totalRegistros ?? null;
      const totalPaginas = latest.pagination?.totalPaginas ?? this.opts.maxPages;
      const merged = new Map<string, UpsertVigenteInput>();
      const pushPage = (p: ParsedVigentePage) => {
        for (const r of p.registros) merged.set(r.numeroProcedimiento, r);
      };
      pushPage(latest);
      onProgress?.({
        page: 1,
        registros: latest.registros.length,
        totalReported,
      });

      // --- Pages 2..N: advance the PrimeNG paginator, capturing each response ---
      const pagesToFetch = Math.min(totalPaginas, this.opts.maxPages);
      for (let nextPage = 2; nextPage <= pagesToFetch; nextPage++) {
        await this.delay();
        const before = latest;
        latest = { registros: [], pagination: before.pagination };

        const clicked = await this.clickPaginatorNext(page);
        if (!clicked) break; // no paginator → no more pages
        await this.settle(page, { short: true });

        if (latest.registros.length === 0) {
          // One retry: the response sometimes lands just after networkidle.
          await page.waitForTimeout(2500);
        }
        if (latest.registros.length === 0) break; // genuinely out of results

        pushPage(latest);
        onProgress?.({
          page: nextPage,
          registros: latest.registros.length,
          totalReported,
        });
      }

      return {
        registros: [...merged.values()],
        totalReported,
        pagesScraped: Math.min(pagesToFetch, Math.max(1, merged.size > 0 ? pagesToFetch : 0)),
        blocked: false,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        registros: [],
        totalReported: null,
        pagesScraped: 0,
        blocked: false,
        error: `Error durante el scrapeo: ${message}`,
      };
    } finally {
      await browser?.close().catch(() => undefined);
    }
  }

  /** Click the paginator's "next page" button (PrimeNG class). */
  private async clickPaginatorNext(page: import('playwright').Page): Promise<boolean> {
    const next = page.locator('.p-paginator-next').first();
    const exists = await next.count().catch(() => 0);
    if (exists === 0) return false;
    const disabled = await next.getAttribute('disabled').catch(() => null);
    if (disabled !== null) return false;
    await next.click({ timeout: 5000 }).catch(() => undefined);
    return true;
  }

  /** Wait for the SPA to bootstrap + the search POST to resolve. */
  private async settle(
    page: import('playwright').Page,
    opts: { short?: boolean } = {},
  ): Promise<void> {
    try {
      await page.waitForLoadState('networkidle', {
        timeout: opts.short ? 15_000 : this.opts.timeoutMs,
      });
    } catch {
      /* networkidle may not fire if the page polls; fall through */
    }
    await page.waitForTimeout(opts.short ? 1500 : 3000).catch(() => undefined);
  }

  private delay(): Promise<void> {
    return new Promise((r) => setTimeout(r, this.opts.delayMs));
  }
}

export { VIGENTE_FILTER_BODY };
