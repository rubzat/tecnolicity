import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import helmet from 'helmet';
import cors from 'cors';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { env } from '../config/env.js';
import { db, pool } from '../db/client.js';
import * as schema from '../db/schema/index.js';
import { DrizzleProcedureQueryRepository } from '../infrastructure/db/repositories/procedure-query-repository.js';
import { DrizzleDocumentRepository } from '../infrastructure/db/repositories/document-repository.js';
import { LocalFilesystemStorage } from '../infrastructure/storage/local-storage.js';
import { InMemoryQueue } from '../infrastructure/queue/in-memory-queue.js';
import { PlaywrightDocFetcher } from '../infrastructure/documents/playwright-fetcher.js';
import { ListProcedures } from '../application/queries/list-procedures.js';
import { GetProcedureDetail } from '../application/queries/get-procedure-detail.js';
import { ComputeAnalytics } from '../application/queries/compute-analytics.js';
import { MarketIntelligence } from '../application/market/market-intelligence.js';
import { SupplierIntelligence } from '../application/suppliers/supplier-intelligence.js';
import { ProductIntelligence } from '../application/products/product-intelligence.js';
import { FetchDocuments } from '../application/documents/fetch-documents.js';
import { ListDocuments } from '../application/documents/list-documents.js';
import { DownloadDocument } from '../application/documents/download-document.js';
import { ScrapeVigentes } from '../application/vigentes/scrape-vigentes.js';
import { FetchVigenteDetail } from '../application/vigentes/fetch-detail.js';
import { DrizzleMarketRepository } from '../infrastructure/db/repositories/market-repository.js';
import { DrizzleSupplierRepository } from '../infrastructure/db/repositories/supplier-repository.js';
import { DrizzleProductRepository } from '../infrastructure/db/repositories/product-repository.js';
import { DrizzleVigenteRepository } from '../infrastructure/db/repositories/vigente-repository.js';
import { VigenteScraper } from '../infrastructure/scraping/vigente-scraper.js';
import { VigenteDetailFetcher } from '../infrastructure/scraping/vigente-detail-fetcher.js';
import { createProceduresRouter } from './routes/procedures.js';
import { createAnalyticsRouter } from './routes/analytics.js';
import { createMarketRouter } from './routes/market.js';
import { createSuppliersRouter } from './routes/suppliers.js';
import { createProductsRouter } from './routes/products.js';
import { createDocumentsRouter } from './routes/documents.js';
import { createVigentesRouter } from './routes/vigentes.js';
import { startVigenteCron, stopVigenteCron } from '../infrastructure/scheduler/vigente-cron.js';

type Db = NodePgDatabase<typeof schema>;

/**
 * Build the Express application. Dependency wiring happens here (composition
 * root): Drizzle repository → use cases → routers. `dbClient` is injectable so
 * tests can supply a custom connection; production uses the shared pool.
 */
export function createApp(dbClient: Db = db): Express {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN }));
  app.use(express.json());

  // Composition root
  const repo = new DrizzleProcedureQueryRepository(dbClient);
  const list = new ListProcedures(repo);
  const detail = new GetProcedureDetail(repo);
  const analytics = new ComputeAnalytics(repo);
  const marketRepo = new DrizzleMarketRepository(dbClient);
  const market = new MarketIntelligence(marketRepo);

  // Supplier Intelligence composition root (PR9). Read-only aggregations over
  // the existing suppliers/contracts tables (no schema change). Two endpoints:
  // accent-insensitive search + full supplier profile analysis.
  const supplierRepo = new DrizzleSupplierRepository(dbClient);
  const supplierIntel = new SupplierIntelligence(supplierRepo);

  // Product Price Intelligence composition root (PR10). Read-only price
  // analytics over the existing contracts/procedures tables (no schema
  // change). Reuses the Market module's segment matcher + GIN indexes. Four
  // endpoints: price-history time series, distribution histogram, top
  // suppliers, and paginated top contracts.
  const productRepo = new DrizzleProductRepository(dbClient);
  const productIntel = new ProductIntelligence(productRepo);

  // Document-fetching composition root (Phase 5). The Playwright worker is
  // isolated from the query/analytics API: it runs through a concurrency-limited
  // queue (DF-5/DF-7) and writes to its own `documents` cache.
  const documentRepo = new DrizzleDocumentRepository(dbClient);
  const storage = new LocalFilesystemStorage(env.STORAGE_PATH);
  const docQueue = new InMemoryQueue({
    concurrency: env.DOCS_FETCH_CONCURRENCY,
    delayMs: env.DOCS_FETCH_DELAY_MS,
  });
  const docFetcher = new PlaywrightDocFetcher({
    storage,
    timeoutMs: env.DOCS_FETCH_TIMEOUT_MS,
    headlessFallback: env.DOCS_FETCH_HEADLESS_FALLBACK,
  });
  const fetchDocuments = new FetchDocuments({
    documents: documentRepo,
    fetcher: docFetcher,
    queue: docQueue,
    enabled: env.DOCS_FETCH_ENABLED,
    timeoutMs: env.DOCS_FETCH_TIMEOUT_MS,
  });
  const listDocuments = new ListDocuments(documentRepo);
  const downloadDocument = new DownloadDocument(documentRepo, storage);

  // Vigente-scraper composition root (PR7). The scraper loads ComprasMX via
  // Playwright (reCAPTCHA bypass) and upserts into vigente_procedures; the API
  // reads from that table. The scrape trigger runs synchronously (it's an
  // on-demand refresh, ~50s for ~1.1k rows).
  const vigenteRepo = new DrizzleVigenteRepository(dbClient);
  const vigenteScraper = new VigenteScraper({
    maxPages: env.SCRAPER_MAX_PAGES,
    delayMs: env.SCRAPER_DELAY_MS,
    timeoutMs: env.SCRAPER_TIMEOUT_MS,
    pageSize: env.SCRAPER_PAGE_SIZE,
  });
  const scrapeVigentes = new ScrapeVigentes({ scraper: vigenteScraper, repository: vigenteRepo });

  // Vigente on-demand detail composition root (PR8). Loads ONE procedure's
  // ComprasMX detail page via Playwright, intercepts the detalle/anexos/
  // reqeconomicos responses, and caches them in vigente_procedures. Cache-first
  // with a 24h TTL — repeated views are instant, the browser only runs on a miss.
  const vigenteDetailFetcher = new VigenteDetailFetcher({ timeoutMs: env.SCRAPER_TIMEOUT_MS });
  const fetchVigenteDetail = new FetchVigenteDetail({
    repository: vigenteRepo,
    fetcher: vigenteDetailFetcher,
    cacheTtlMs: env.VIGENTE_DETAIL_CACHE_TTL_MS,
    timeoutMs: env.SCRAPER_TIMEOUT_MS,
  });

  // Health check (also serves as the DB liveness probe).
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  // Routes — all mounted under /api (design REST contract).
  app.use('/api/procedures', createProceduresRouter({ list, detail }));
  app.use('/api/procedures', createDocumentsRouter({ fetch: fetchDocuments, list: listDocuments, download: downloadDocument }));
  app.use('/api/analytics', createAnalyticsRouter({ analytics }));
  app.use('/api/market', createMarketRouter({ market }));
  app.use('/api/suppliers', createSuppliersRouter({ suppliers: supplierIntel }));
  app.use('/api/products', createProductsRouter({ products: productIntel }));
  app.use('/api/vigentes', createVigentesRouter({ repository: vigenteRepo, scrape: scrapeVigentes, fetchDetail: fetchVigenteDetail }));

  // 404 for unknown /api routes.
  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'not_found' });
  });

  // Centralized error handler — converts unhandled errors to 500 JSON.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[server] unhandled error:', err);
    res.status(500).json({ error: 'internal_error' });
  });

  return app;
}

/** Start listening. Call once from the process entry point. */
export function startServer(): { app: Express; close: () => Promise<void> } {
  const app = createApp();
  const server = app.listen(env.PORT, () => {
    console.log(`[backend] listening on :${env.PORT} (${env.NODE_ENV})`);
  });

  // Start the daily vigente scraper cron (configured via SCRAPE_CRON_*).
  startVigenteCron();

  return {
    app,
    close: async () => {
      stopVigenteCron();
      server.close();
      await pool.end();
    },
  };
}
