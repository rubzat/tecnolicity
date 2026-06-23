import { chromium, type Browser } from 'playwright';
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

      // Match any expedientes SEARCH response (not the detail GET).
      const isSearchRes = (url: string): boolean => EXP_RE.test(url) && WHITNEY_RE.test(url);

      // --- Page 1: load the SPA, wait for the first search POST, parse it ---
      const firstResponse = page.waitForResponse((r) => isSearchRes(r.url()) && r.ok(), {
        timeout: this.opts.timeoutMs,
      });
      await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: this.opts.timeoutMs });

      let sawForbidden = false;
      let first: ParsedVigentePage;
      try {
        first = parseSearchResponse(await (await firstResponse).json());
      } catch {
        // Fall back to a settle if the structured wait failed (slow bootstrap).
        await this.settle(page);
        first = { registros: [], pagination: null };
      }
      // Detect a reCAPTCHA 403 block separately (the ok()-predicate skips it).
      page.on('response', (r) => {
        if (r.status() === 403 && isSearchRes(r.url())) sawForbidden = true;
      });

      if (first.registros.length === 0) {
        // Give the search one more chance (reCAPTCHA scoring can delay it).
        await page.waitForTimeout(3000);
      }

      if (first.registros.length === 0) {
        return {
          registros: [],
          totalReported: null,
          pagesScraped: 0,
          blocked: sawForbidden,
          error: sawForbidden
            ? 'ComprasMX rechazó la solicitud (reCAPTCHA v3 / 403). No se pudieron obtener los procedimientos vigentes.'
            : 'La búsqueda de vigentes no devolvió registros.',
        };
      }

      const totalReported = first.pagination?.totalRegistros ?? null;
      const totalPaginas = first.pagination?.totalPaginas ?? this.opts.maxPages;
      const merged = new Map<string, UpsertVigenteInput>();
      const pushPage = (p: ParsedVigentePage) => {
        for (const r of p.registros) merged.set(r.numeroProcedimiento, r);
      };
      pushPage(first);
      onProgress?.({ page: 1, registros: first.registros.length, totalReported });

      // --- Pages 2..N: click paginator-next AND wait for the matching POST ---
      // Using Promise.all so the response listener is armed BEFORE the click
      // fires — this eliminates the networkidle race that caused skipped pages.
      const pagesToFetch = Math.min(totalPaginas, this.opts.maxPages);
      let pagesScraped = 1;
      for (let nextPage = 2; nextPage <= pagesToFetch; nextPage++) {
        const next = page.locator('.p-paginator-next').first();
        const disabled = (await next.getAttribute('disabled').catch(() => 'x')) !== null;
        if (disabled) break;

        await this.delay();
        let parsed: ParsedVigentePage | null = null;
        try {
          const [response] = await Promise.all([
            page.waitForResponse((r) => isSearchRes(r.url()) && r.ok(), { timeout: this.opts.timeoutMs }),
            next.click({ timeout: 5000 }),
          ]);
          parsed = parseSearchResponse(await response.json());
        } catch {
          // Click or response failed → stop (no more pages / transient error).
          break;
        }

        if (parsed.registros.length === 0) break; // genuinely out of results
        pushPage(parsed);
        pagesScraped = nextPage;
        onProgress?.({
          page: nextPage,
          registros: parsed.registros.length,
          totalReported,
        });
      }

      return {
        registros: [...merged.values()],
        totalReported,
        pagesScraped,
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
