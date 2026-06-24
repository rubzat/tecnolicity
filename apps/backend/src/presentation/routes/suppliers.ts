import { Router, type Request, type Response, type NextFunction } from 'express';
import { ZodError } from 'zod';
import { supplierSearchSchema } from '@tecnolicity/shared';
import type { SupplierIntelligence } from '../../application/suppliers/supplier-intelligence.js';

/**
 * Build the `/suppliers` router (PR9). Two endpoints:
 *  - GET /suppliers/search?q=&page=&page_size= — accent-insensitive name/RFC search
 *  - GET /suppliers/:rfc/profile             — full supplier analysis
 */
export function createSuppliersRouter(deps: {
  suppliers: SupplierIntelligence;
}): Router {
  const router = Router();

  // GET /suppliers/search — ranked supplier search with pre-computed totals.
  router.get('/search', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const params = supplierSearchSchema.parse(req.query);
      const result = await deps.suppliers.search(params.q, params.page, params.page_size);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // GET /suppliers/:rfc/profile — complete supplier profile.
  router.get(
    '/:rfc/profile',
    async (req: Request<{ rfc: string }>, res: Response, next: NextFunction) => {
      try {
        const rfc = req.params.rfc;
        const result = await deps.suppliers.getProfile(rfc);
        if (!result) {
          res.status(404).json({ error: 'supplier_not_found', rfc });
          return;
        }
        res.json(result);
      } catch (err) {
        next(err);
      }
    },
  );

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
