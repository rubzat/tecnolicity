import { Router, type Request, type Response, type NextFunction } from 'express';
import { ZodError } from 'zod';
import {
  productPriceHistorySchema,
  productDistributionSchema,
  productSuppliersSchema,
  productTopContractsSchema,
  parseProductKeywords,
} from '@tecnolicity/shared';
import type { ProductIntelligence } from '../../application/products/product-intelligence.js';

/**
 * Build the `/products` router (PR10). Four endpoints, all driven by a
 * `?q=k1,k2,...` keyword list:
 *  - GET /products/price-history?q=&group_by=year|quarter|month
 *  - GET /products/distribution?q=
 *  - GET /suppliers?q=&limit=          (top suppliers in the segment)
 *  - GET /products/top-contracts?q=&page=&page_size=
 *
 * The router is a thin transport layer: it parses + validates the query, splits
 * the comma-separated `q` into a `string[]` (via {@link parseProductKeywords}),
 * and delegates to {@link ProductIntelligence}. The tsquery construction lives
 * in the use case, not here.
 *
 * Error handling mirrors `market.ts` / `suppliers.ts`: ZodError → 400 with the
 * list of issues, everything else falls through to the centralized 500 handler.
 */
export function createProductsRouter(deps: {
  products: ProductIntelligence;
}): Router {
  const router = Router();

  // GET /products/price-history — time series of avg/median/min/max/total +
  // an overall bucket + a trend classification.
  router.get('/price-history', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const params = productPriceHistorySchema.parse(req.query);
      const keywords = parseProductKeywords(params.q);
      assertKeywords(keywords);
      const result = await deps.products.priceHistory(keywords, params.group_by);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // GET /products/distribution — fixed histogram buckets (< 10K … > 100M).
  router.get('/distribution', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const params = productDistributionSchema.parse(req.query);
      const keywords = parseProductKeywords(params.q);
      assertKeywords(keywords);
      const result = await deps.products.distribution(keywords);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // GET /products/suppliers — top suppliers by total amount in the segment.
  router.get('/suppliers', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const params = productSuppliersSchema.parse(req.query);
      const keywords = parseProductKeywords(params.q);
      assertKeywords(keywords);
      const result = await deps.products.suppliers(keywords, params.limit);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // GET /products/top-contracts — paginated top contracts by amount.
  // Accepts `page_size` (primary) or `limit` (alias) so both curl forms work.
  router.get('/top-contracts', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const params = productTopContractsSchema.parse(req.query);
      const keywords = parseProductKeywords(params.q);
      assertKeywords(keywords);
      const pageSize = params.limit ?? params.page_size;
      const result = await deps.products.topContracts(keywords, params.page, pageSize);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  router.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof ZodError) {
      res.status(400).json({
        error: 'invalid_query',
        issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
      return;
    }
    // `q=,,,` passed the schema (non-empty raw string) but yielded no keywords.
    if (err instanceof EmptyKeywordsError) {
      res.status(400).json({
        error: 'invalid_query',
        issues: [{ path: 'q', message: err.message }],
      });
      return;
    }
    next(err);
  });

  return router;
}

/**
 * Reject requests whose `q` contained only commas/whitespace. The zod schema
 * enforces presence + length on the RAW string, but the post-split list could
 * still be empty (e.g. `q=,,,`). Throwing here keeps the use case free of
 * "what if keywords is empty?" defensive branches.
 */
function assertKeywords(keywords: string[]): void {
  if (keywords.length === 0) {
    throw new EmptyKeywordsError();
  }
}

/** Sentinel so the router's error handler can map it to a 400 (not a 500). */
export class EmptyKeywordsError extends Error {
  constructor() {
    super('q must contain at least one non-empty keyword');
    this.name = 'EmptyKeywordsError';
  }
}
