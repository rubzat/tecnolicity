import { Router, type Request, type Response, type NextFunction } from 'express';
import type { ListDocuments } from '../../application/documents/list-documents.js';
import type { FetchDocuments } from '../../application/documents/fetch-documents.js';
import type { DownloadDocument } from '../../application/documents/download-document.js';

/**
 * Build the `/procedures/:numero/documents` router.
 *
 * Mounted under `/api/procedures` (same base as the procedure router — the
 * `:numero/documents` suffix never collides with `:numero` which matches a
 * single segment). Use cases are injected (hexagonal adapter).
 *
 * Response contract:
 *  - GET    /:numero/documents               → cached rows (or [] if not fetched)
 *  - POST   /:numero/documents/fetch         → cache-first on-demand fetch
 *  - GET    /:numero/documents/:id/download  → serve the downloaded file
 *
 * reCAPTCHA / timeout / partial outcomes are returned with HTTP 200 + a `status`
 * field (they are EXPECTED operational results, not server errors — DF-6). Only
 * an unknown procedure yields 404.
 */
export function createDocumentsRouter(deps: {
  list: ListDocuments;
  fetch: FetchDocuments;
  download: DownloadDocument;
}): Router {
  const router = Router();

  // GET /:numeroProcedimiento/documents — cached documents (DF-1 read)
  router.get(
    '/:numeroProcedimiento/documents',
    async (
      req: Request<{ numeroProcedimiento: string }>,
      res: Response,
      next: NextFunction,
    ) => {
      try {
        const numero = req.params.numeroProcedimiento;
        const { found, documents } = await deps.list.execute(numero);
        if (!found) {
          res.status(404).json({
            error: 'not_found',
            message: `No procedure with numero_procedimiento '${numero}'`,
          });
          return;
        }
        res.json({ data: serializeDocuments(numero, documents) });
      } catch (err) {
        next(err);
      }
    },
  );

  // POST /:numeroProcedimiento/documents/fetch — cache-first on-demand fetch
  router.post(
    '/:numeroProcedimiento/documents/fetch',
    async (
      req: Request<{ numeroProcedimiento: string }>,
      res: Response,
      next: NextFunction,
    ) => {
      try {
        const numero = req.params.numeroProcedimiento;
        const result = await deps.fetch.execute(numero);
        if (!result) {
          res.status(404).json({
            error: 'not_found',
            message: `No procedure with numero_procedimiento '${numero}'`,
          });
          return;
        }
        // Every operational outcome (even captcha_blocked / timeout) is HTTP 200;
        // the `status` field tells the client what happened (DF-6 graceful).
        res.status(200).json({
          status: result.status,
          documents: serializeDocuments(numero, result.documents),
          ...(result.message ? { message: result.message } : {}),
        });
      } catch (err) {
        next(err);
      }
    },
  );

  // GET /:numeroProcedimiento/documents/:documentId/download — serve the file
  router.get(
    '/:numeroProcedimiento/documents/:documentId/download',
    async (
      req: Request<{ numeroProcedimiento: string; documentId: string }>,
      res: Response,
      next: NextFunction,
    ) => {
      try {
        const numero = req.params.numeroProcedimiento;
        const documentId = Number(req.params.documentId);
        if (!Number.isFinite(documentId)) {
          res.status(400).json({ error: 'invalid_document_id' });
          return;
        }
        const info = await deps.download.execute(numero, documentId);
        if (!info) {
          res.status(404).json({
            error: 'not_found',
            message: 'Documento no disponible para descarga.',
          });
          return;
        }
        // res.download sets Content-Disposition: attachment + infers Content-Type.
        res.download(info.absolutePath, info.filename, (err) => {
          if (err) next(err);
        });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}

/**
 * Serialize document rows to the API wire format (snake_case + ISO dates),
 * matching the REST contract used by the frontend. `numeroProcedimiento` is
 * needed to build the per-document download_url.
 */
function serializeDocuments(
  numeroProcedimiento: string,
  documents: readonly {
    id: number;
    titulo: string | null;
    tipo: string | null;
    urlFuente: string | null;
    archivoLocal: string | null;
    storageRef: string | null;
    fechaDescarga: Date | null;
    estatus: string;
    error: string | null;
  }[],
): unknown[] {
  const numero = encodeURIComponent(numeroProcedimiento);
  return documents.map((d) => ({
    id: d.id,
    titulo: d.titulo,
    tipo: d.tipo,
    url_fuente: d.urlFuente,
    archivo_local: d.archivoLocal,
    fecha_descarga: d.fechaDescarga ? d.fechaDescarga.toISOString() : null,
    estatus: d.estatus,
    ...(d.error ? { error: d.error } : {}),
    // Download link (only when a local file exists).
    ...(d.archivoLocal
      ? {
          download_url: `/api/procedures/${numero}/documents/${d.id}/download`,
        }
      : {}),
  }));
}
