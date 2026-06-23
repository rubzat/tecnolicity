import { Router, type Request, type Response, type NextFunction } from 'express';
import { ZodError } from 'zod';
import {
  parseSegmentParam,
  marketQuerySchema,
  marketPagedQuerySchema,
  marketExpiringQuerySchema,
} from '@tecnolicity/shared';
import type { MarketIntelligence } from '../../application/market/market-intelligence.js';

/**
 * Build the `/market` router. Every endpoint accepts a `?segment=k1,k2,...`
 * query param (falls back to the default Tecnolicity keyword set when absent).
 */
export function createMarketRouter(deps: { market: MarketIntelligence }): Router {
  const router = Router();

  // GET /market/overview — segment market size + trend
  router.get('/overview', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const params = marketQuerySchema.parse(req.query);
      const { keywords, usedDefault } = parseSegmentParam(params.segment);
      const result = await deps.market.overview(keywords);
      res.json({ ...result, segment_used_default: usedDefault });
    } catch (err) {
      next(err);
    }
  });

  // GET /market/competitors — top suppliers by amount
  router.get('/competitors', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const params = marketQuerySchema.parse(req.query);
      const { keywords } = parseSegmentParam(params.segment);
      const result = await deps.market.competitors(keywords, params.limit);
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  });

  // GET /market/buyers — top buying institutions
  router.get('/buyers', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const params = marketQuerySchema.parse(req.query);
      const { keywords } = parseSegmentParam(params.segment);
      const result = await deps.market.buyers(keywords, params.limit);
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  });

  // GET /market/opportunities — recently-opened procedures (biddable leads)
  router.get('/opportunities', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const params = marketPagedQuerySchema.parse(req.query);
      const { keywords } = parseSegmentParam(params.segment);
      const result = await deps.market.opportunities(keywords, params.page, params.limit);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // GET /market/expiring — contracts ending within N months (renewal leads)
  router.get('/expiring', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const params = marketExpiringQuerySchema.parse(req.query);
      const { keywords } = parseSegmentParam(params.segment);
      const result = await deps.market.expiring(keywords, params.months, params.limit);
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  });

  // GET /market/dominance — institutions with a dominant supplier
  router.get('/dominance', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const params = marketQuerySchema.parse(req.query);
      const { keywords } = parseSegmentParam(params.segment);
      const result = await deps.market.dominance(keywords, params.limit);
      res.json({ data: result });
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
    next(err);
  });

  return router;
}
