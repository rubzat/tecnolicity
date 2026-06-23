import { Router, type Request, type Response, type NextFunction } from 'express';
import { ZodError } from 'zod';
import { analyticsQuerySchema, procedureFilterSchema } from '@tecnolicity/shared';
import type { ComputeAnalytics } from '../../application/queries/compute-analytics.js';

/** Build the `/analytics` router. All endpoints reuse the list filters (CA-6). */
export function createAnalyticsRouter(deps: { analytics: ComputeAnalytics }): Router {
  const router = Router();

  // GET /analytics/summary — totals + distribution (CA-4) + by-estatus (CA-5)
  router.get('/summary', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const filters = procedureFilterSchema.parse(req.query);
      const result = await deps.analytics.summary(filters);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // GET /analytics/by-institucion — total amount grouped by institution (CA-1)
  router.get('/by-institucion', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const params = analyticsQuerySchema.parse(req.query);
      const { limit, ...filters } = params;
      const result = await deps.analytics.byInstitucion({ ...filters, limit });
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  });

  // GET /analytics/by-tipo-contratacion — by tipo_contratacion + tipo_procedimiento (CA-2)
  router.get('/by-tipo-contratacion', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const filters = procedureFilterSchema.parse(req.query);
      const result = await deps.analytics.byTipoContratacion(filters);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // GET /analytics/top-proveedores — top suppliers by total contract importe (CA-3)
  router.get('/top-proveedores', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const params = analyticsQuerySchema.parse(req.query);
      const { limit, ...filters } = params;
      const result = await deps.analytics.topProveedores({ ...filters, limit });
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
