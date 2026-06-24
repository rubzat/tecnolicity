import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import type {
  VigenteRepository,
  VigenteRecord,
  VigentePage,
} from '../../domain/repositories/vigente-repository.js';
import type { ScrapeVigentes } from '../../application/vigentes/scrape-vigentes.js';
import type { FetchVigenteDetail } from '../../application/vigentes/fetch-detail.js';

/**
 * Build the `/vigentes` router.
 *
 * Endpoints:
 *  - GET  /                                       list (filters + pagination)
 *  - GET  /:numeroProcedimiento                   detail (summary fields)
 *  - GET  /:numeroProcedimiento/detail            cached on-demand detail JSON (PR8)
 *  - POST /:numeroProcedimiento/fetch-detail      trigger a Playwright fetch (PR8)
 *  - POST /scrape                                 trigger a live scrape
 *
 * Use cases / repository are injected (hexagonal adapter). Route ordering:
 * `:numeroProcedimiento/detail` and `:numeroProcedimiento/fetch-detail` are
 * TWO segments, so they never collide with the single-segment `:numeroProcedimiento`
 * route. `POST /scrape` is distinct from any `:numero` (numeros never equal "scrape").
 */
export function createVigentesRouter(deps: {
  repository: VigenteRepository;
  scrape: ScrapeVigentes;
  fetchDetail: FetchVigenteDetail;
}): Router {
  const router = Router();

  const listQuery = z.object({
    page: z.coerce.number().int().min(1).default(1),
    page_size: z.coerce.number().int().min(1).max(100).default(20),
    tipo_contratacion: z.string().trim().optional(),
    tipo_procedimiento: z.string().trim().optional(),
    dependencia: z.string().trim().optional(),
    siglas: z.string().trim().optional(),
    entidad_federativa: z.string().trim().optional(),
    q: z.string().trim().optional(),
  });

  // GET /vigentes — list with filters + pagination, most-urgent deadline first.
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = listQuery.parse(req.query);
      const page = await deps.repository.list(
        {
          tipoContratacion: q.tipo_contratacion,
          tipoProcedimiento: q.tipo_procedimiento,
          dependencia: q.dependencia,
          siglas: q.siglas,
          entidadFederativa: q.entidad_federativa,
          q: q.q,
        },
        q.page,
        q.page_size,
      );
      res.json(serializePage(page));
    } catch (err) {
      next(err);
    }
  });

  // GET /vigentes/:numeroProcedimiento — single procedure detail.
  router.get(
    '/:numeroProcedimiento',
    async (
      req: Request<{ numeroProcedimiento: string }>,
      res: Response,
      next: NextFunction,
    ) => {
      try {
        const numero = req.params.numeroProcedimiento;
        const rec = await deps.repository.getByNumero(numero);
        if (!rec) {
          res.status(404).json({
            error: 'not_found',
            message: `No hay procedimiento vigente con numero_procedimiento '${numero}'`,
          });
          return;
        }
        res.json(serialize(rec));
      } catch (err) {
        next(err);
      }
    },
  );

  // GET /vigentes/:numeroProcedimiento/detail — cached on-demand detail (PR8).
  // Returns the intercepted detalle/anexos/reqeconomicos JSON, or null fields
  // when no fetch has happened yet. Never launches Playwright.
  router.get(
    '/:numeroProcedimiento/detail',
    async (
      req: Request<{ numeroProcedimiento: string }>,
      res: Response,
      next: NextFunction,
    ) => {
      try {
        const numero = req.params.numeroProcedimiento;
        const exists = await deps.repository.getByNumero(numero);
        if (!exists) {
          res.status(404).json({
            error: 'not_found',
            message: `No hay procedimiento vigente con numero_procedimiento '${numero}'`,
          });
          return;
        }
        const cache = await deps.repository.getDetalle(numero);
        res.json({
          detalle: cache?.detalleJson ?? null,
          anexos: cache?.anexosJson ?? null,
          reqeconomicos: cache?.reqeconomicosJson ?? null,
          detalle_fetched_at: cache?.detalleFetchedAt
            ? cache.detalleFetchedAt.toISOString()
            : null,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  // POST /vigentes/:numeroProcedimiento/fetch-detail — on-demand Playwright fetch (PR8).
  // Loads the ComprasMX detail page, intercepts the 3 API responses, caches the
  // result, and returns it. Takes ~8-15s on a cache miss; instant on a hit.
  // Every operational outcome (even captcha_blocked / timeout / failed) is HTTP
  // 200 — the `status` field tells the client what happened (graceful, #213).
  router.post(
    '/:numeroProcedimiento/fetch-detail',
    async (
      req: Request<{ numeroProcedimiento: string }>,
      res: Response,
      next: NextFunction,
    ) => {
      try {
        const numero = req.params.numeroProcedimiento;
        const result = await deps.fetchDetail.execute(numero);
        if (!result) {
          res.status(404).json({
            error: 'not_found',
            message: `No hay procedimiento vigente con numero_procedimiento '${numero}'`,
          });
          return;
        }
        res.status(200).json({
          status: result.status,
          detalle: result.detalle,
          anexos: result.anexos,
          reqeconomicos: result.reqeconomicos,
          detalle_fetched_at: result.detalleFetchedAt,
          ...(result.message ? { message: result.message } : {}),
        });
      } catch (err) {
        next(err);
      }
    },
  );

  // POST /vigentes/scrape — trigger a live scrape (synchronous).
  // Returns the summary so the UI can show "X found, Y inserted, Z updated".
  router.post('/scrape', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const summary = await deps.scrape.execute();
      const status =
        summary.status === 'ok' ? 200 : summary.status === 'blocked' ? 503 : 500;
      res.status(status).json(summary);
    } catch (err) {
      next(err);
    }
  });

  // Surface Zod validation errors as 400.
  router.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof z.ZodError) {
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

/** Domain record (camelCase, Date) → API wire (snake_case, ISO). */
function serialize(r: VigenteRecord) {
  return {
    id: r.id,
    numero_procedimiento: r.numeroProcedimiento,
    nombre: r.nombre,
    caracter: r.caracter,
    dependencia: r.dependencia,
    siglas_dependencia: r.siglasDependencia,
    estatus: r.estatus,
    fecha_junta_aclaraciones: r.fechaJuntaAclaraciones ? r.fechaJuntaAclaraciones.toISOString() : null,
    fecha_presentacion_apertura: r.fechaPresentacionApertura
      ? r.fechaPresentacionApertura.toISOString()
      : null,
    tipo_procedimiento: r.tipoProcedimiento,
    tipo_contratacion: r.tipoContratacion,
    unidad_compradora: r.unidadCompradora,
    codigo_expediente: r.codigoExpediente,
    uuid_procedimiento: r.uuidProcedimiento,
    direcciones_anuncio: r.direccionesAnuncio,
    entidad_federativa: r.entidadFederativa,
    scraped_at: r.scrapedAt.toISOString(),
  };
}

function serializePage(page: VigentePage) {
  return { data: page.data.map(serialize), pagination: page.pagination };
}
