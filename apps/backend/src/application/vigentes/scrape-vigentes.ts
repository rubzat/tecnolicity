import type { VigenteRepository, UpsertVigenteInput } from '../../domain/repositories/vigente-repository.js';
import type { VigenteScraper } from '../../infrastructure/scraping/vigente-scraper.js';

/**
 * Use case: scrape all "Anuncios vigentes" from ComprasMX and upsert them into
 * the `vigente_procedures` table (PR7). Thin orchestration: the scraper
 * fetches+normalizes (Playwright), the repository persists (idempotent by
 * numero_procedimiento).
 *
 * Keeping the orchestration here (not in the route/CLI) means the HTTP and CLI
 * adapters share one code path and one summary shape.
 */
export interface ScrapeVigentesSummary {
  status: 'ok' | 'blocked' | 'failed';
  totalReported: number | null;
  pagesScraped: number;
  found: number;
  inserted: number;
  updated: number;
  message?: string;
}

export interface ScrapeVigentesDeps {
  scraper: Pick<VigenteScraper, 'scrape'>;
  repository: Pick<VigenteRepository, 'upsertMany'>;
}

export class ScrapeVigentes {
  constructor(private readonly deps: ScrapeVigentesDeps) {}

  async execute(): Promise<ScrapeVigentesSummary> {
    const result = await this.deps.scraper.scrape();
    if (result.registros.length === 0) {
      return {
        status: result.blocked ? 'blocked' : 'failed',
        totalReported: result.totalReported,
        pagesScraped: result.pagesScraped,
        found: 0,
        inserted: 0,
        updated: 0,
        message: result.error,
      };
    }

    const rows: UpsertVigenteInput[] = result.registros;
    const { inserted, updated } = await this.deps.repository.upsertMany(rows);

    return {
      status: 'ok',
      totalReported: result.totalReported,
      pagesScraped: result.pagesScraped,
      found: rows.length,
      inserted,
      updated,
    };
  }
}
