import { Router, type Request, type Response, type NextFunction } from 'express';
import { ZodError } from 'zod';
import { procedureListQuerySchema } from '@tecnolicity/shared';
import type { ListProcedures } from '../../application/queries/list-procedures.js';
import type { GetProcedureDetail } from '../../application/queries/get-procedure-detail.js';

/** Build the `/procedures` router. Use cases are injected (hexagonal adapter). */
export function createProceduresRouter(deps: {
  list: ListProcedures;
  detail: GetProcedureDetail;
}): Router {
  const router = Router();

  // GET /procedures — list with filters + pagination + sorting + search (PQ-1..3)
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = procedureListQuerySchema.parse(req.query);
      const page = await deps.list.execute(
        {
          institucion: q.institucion,
          tipo_contratacion: q.tipo_contratacion,
          tipo_procedimiento: q.tipo_procedimiento,
          estatus: q.estatus,
          proveedor: q.proveedor,
          ley: q.ley,
          monto_min: q.monto_min,
          monto_max: q.monto_max,
          fecha_desde: q.fecha_desde,
          fecha_hasta: q.fecha_hasta,
          q: q.q,
        },
        q.page,
        q.page_size,
        q.sort,
        q.order,
      );
      res.json(page); // { data, pagination } (PQ response shape)
    } catch (err) {
      next(err);
    }
  });

  // GET /procedures/:numeroProcedimiento — full detail (PQ-4), 404 on unknown (PQ-5)
  router.get(
    '/:numeroProcedimiento',
    async (
      req: Request<{ numeroProcedimiento: string }>,
      res: Response,
      next: NextFunction,
    ) => {
      try {
        const numero = req.params.numeroProcedimiento;
        const detail = await deps.detail.execute(numero);
        if (!detail) {
          res.status(404).json({
            error: 'not_found',
            message: `No procedure with numero_procedimiento '${numero}'`,
          });
          return;
        }
        res.json(detail);
      } catch (err) {
        next(err);
      }
    },
  );

  // Surface Zod validation errors as 400 instead of generic 500.
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
