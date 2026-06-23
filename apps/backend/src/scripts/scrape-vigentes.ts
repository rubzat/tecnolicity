import dotenv from 'dotenv';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '../db/schema/index.js';
import { DrizzleVigenteRepository } from '../infrastructure/db/repositories/vigente-repository.js';
import { VigenteScraper } from '../infrastructure/scraping/vigente-scraper.js';
import { ScrapeVigentes } from '../application/vigentes/scrape-vigentes.js';

// Monorepo: .env lives at the workspace root (two levels up from apps/backend).
dotenv.config({ path: '../../.env' });

/**
 * CLI entry for the vigente-procedures scraper (PR7).
 *
 * Usage:
 *   pnpm --filter backend scrape-vigentes
 *
 * Env:
 *   DATABASE_URL       — postgres connection string (required)
 *   SCRAPER_MAX_PAGES  — cap on result pages (default 50)
 *   SCRAPER_DELAY_MS   — delay between page loads (default 2000)
 *   SCRAPER_TIMEOUT_MS — per-page navigation timeout (default 45000)
 *   SCRAPER_PAGE_SIZE  — rows per API page, max 100 (default 100)
 *
 * Connects to ComprasMX, intercepts the "Anuncios vigentes" search POST,
 * paginates through every result, and upserts them into vigente_procedures.
 */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('[scrape-vigentes] DATABASE_URL is not set');
    process.exit(1);
  }

  const maxPages = Number(process.env.SCRAPER_MAX_PAGES ?? 50);
  const delayMs = Number(process.env.SCRAPER_DELAY_MS ?? 2000);
  const timeoutMs = Number(process.env.SCRAPER_TIMEOUT_MS ?? 45_000);
  const pageSize = Number(process.env.SCRAPER_PAGE_SIZE ?? 100);

  const pool = new pg.Pool({ connectionString: url, max: 10 });
  const db = drizzle(pool, { schema });

  const repository = new DrizzleVigenteRepository(db);
  const scraper = new VigenteScraper({ maxPages, delayMs, timeoutMs, pageSize });
  const useCase = new ScrapeVigentes({ scraper, repository });

  const started = Date.now();
  console.log('[scrape-vigentes] starting scrape of ComprasMX "Anuncios vigentes"');
  console.log(`[scrape-vigentes]   max_pages=${maxPages} delay_ms=${delayMs} page_size=${pageSize}`);

  const summary = await useCase.execute();

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\n[scrape-vigentes] done in ${elapsed}s — status: ${summary.status}`);
  console.log(`  pages scraped:  ${summary.pagesScraped}`);
  console.log(`  total reported: ${summary.totalReported ?? '(unknown)'}`);
  console.log(`  found:          ${summary.found}`);
  console.log(`  inserted:       ${summary.inserted}`);
  console.log(`  updated:        ${summary.updated}`);

  if (summary.message) {
    console.log(`  message: ${summary.message}`);
  }

  // Sample the freshest rows so the operator can eyeball the mapping.
  if (summary.found > 0) {
    const sample = await pool.query(
      `SELECT numero_procedimiento, siglas_dependencia, tipo_contratacion,
              to_char(fecha_presentacion_apertura AT TIME ZONE 'America/Mexico_City', 'YYYY-MM-DD HH24:MI') AS apertura
         FROM vigente_procedures
        ORDER BY scraped_at DESC, fecha_presentacion_apertura ASC NULLS LAST
        LIMIT 5;`,
    );
    console.log('\n  sample (5 most recent):');
    for (const row of sample.rows) {
      console.log(
        `    ${row.numero_procedimiento}  [${row.siglas_dependencia ?? '??'}]  ${row.tipo_contratacion ?? '??'}  → ${row.apertura ?? '(sin fecha)'}`,
      );
    }
  }

  await pool.end();

  if (summary.status === 'failed' || summary.status === 'blocked') {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('[scrape-vigentes] failed:', err);
  process.exit(1);
});
