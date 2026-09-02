import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import type { SavedSearchRepository, SavedSearchRecord } from '../../domain/repositories/saved-search-repository.js';
import type { UserRepository } from '../../domain/repositories/user-repository.js';
import { createRequireAdmin, getCurrentUser } from '../middleware/require-admin.js';

const filtersSchema = z.object({
  tipo_contratacion: z.string().trim().min(1).optional(),
  tipo_procedimiento: z.string().trim().min(1).optional(),
  dependencia: z.string().trim().min(1).optional(),
  siglas: z.string().trim().min(1).optional(),
  entidad_federativa: z.string().trim().min(1).optional(),
  q: z.string().trim().min(1).optional(),
});

const createBody = z.object({
  name: z.string().trim().min(1, 'name is required'),
  filters: filtersSchema,
});

const updateBody = z.object({
  name: z.string().trim().min(1).optional(),
  filters: filtersSchema.optional(),
  active: z.boolean().optional(),
});

function toDomainFilters(body: z.infer<typeof filtersSchema>): SavedSearchRecord['filters'] {
  return {
    ...(body.tipo_contratacion !== undefined ? { tipoContratacion: body.tipo_contratacion } : {}),
    ...(body.tipo_procedimiento !== undefined ? { tipoProcedimiento: body.tipo_procedimiento } : {}),
    ...(body.dependencia !== undefined ? { dependencia: body.dependencia } : {}),
    ...(body.siglas !== undefined ? { siglas: body.siglas } : {}),
    ...(body.entidad_federativa !== undefined ? { entidadFederativa: body.entidad_federativa } : {}),
    ...(body.q !== undefined ? { q: body.q } : {}),
  };
}

function serialize(s: SavedSearchRecord) {
  return {
    id: s.id,
    name: s.name,
    filters: {
      tipo_contratacion: s.filters.tipoContratacion ?? null,
      tipo_procedimiento: s.filters.tipoProcedimiento ?? null,
      dependencia: s.filters.dependencia ?? null,
      siglas: s.filters.siglas ?? null,
      entidad_federativa: s.filters.entidadFederativa ?? null,
      q: s.filters.q ?? null,
    },
    active: s.active,
    created_at: s.createdAt.toISOString(),
  };
}

/**
 * Todas las rutas requieren sesión — montado en /api/admin/saved-searches.
 * A diferencia de /admin/users y /admin/api-keys, aquí cada cuenta solo ve y
 * administra SUS PROPIAS búsquedas (son datos personales de seguimiento, no
 * configuración compartida del equipo).
 */
export function createAdminSavedSearchesRouter(deps: { savedSearches: SavedSearchRepository; users: UserRepository }): Router {
  const router = Router();
  router.use(createRequireAdmin(deps.users));

  router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const currentUser = getCurrentUser(res)!;
      const rows = await deps.savedSearches.listByUser(currentUser.id);
      res.json({ data: rows.map(serialize) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const currentUser = getCurrentUser(res)!;
      const body = createBody.parse(req.body);
      const created = await deps.savedSearches.create({
        userId: currentUser.id,
        name: body.name,
        filters: toDomainFilters(body.filters),
      });
      res.status(201).json(serialize(created));
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:id', async (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        res.status(400).json({ error: 'invalid_id' });
        return;
      }
      const currentUser = getCurrentUser(res)!;
      const existing = await deps.savedSearches.findById(id);
      if (!existing || existing.userId !== currentUser.id) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      const body = updateBody.parse(req.body);
      const updated = await deps.savedSearches.update(id, {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.filters !== undefined ? { filters: toDomainFilters(body.filters) } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
      });
      res.json(serialize(updated!));
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', async (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        res.status(400).json({ error: 'invalid_id' });
        return;
      }
      const currentUser = getCurrentUser(res)!;
      const existing = await deps.savedSearches.findById(id);
      if (!existing || existing.userId !== currentUser.id) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      await deps.savedSearches.delete(id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  router.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof z.ZodError) {
      res.status(400).json({
        error: 'invalid_body',
        issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
      return;
    }
    next(err);
  });

  return router;
}
