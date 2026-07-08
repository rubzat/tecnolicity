import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import type { UserRepository, UserRecord } from '../../domain/repositories/user-repository.js';
import { hashPassword } from '../../infrastructure/auth/password.js';
import { createRequireAdmin } from '../middleware/require-admin.js';

const createBody = z.object({
  username: z.string().trim().min(1, 'username is required'),
  password: z.string().min(8, 'password must be at least 8 characters'),
});

const updateBody = z.object({
  active: z.boolean().optional(),
  password: z.string().min(8).optional(),
});

function serialize(u: UserRecord) {
  return {
    id: u.id,
    username: u.username,
    active: u.active,
    last_login_at: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
    created_at: u.createdAt.toISOString(),
  };
}

/** All routes require an admin session — mounted at /api/admin/users. */
export function createAdminUsersRouter(deps: { users: UserRepository }): Router {
  const router = Router();
  router.use(createRequireAdmin(deps.users));

  router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const users = await deps.users.list();
      res.json({ data: users.map(serialize) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = createBody.parse(req.body);
      const existing = await deps.users.findByUsername(body.username);
      if (existing) {
        res.status(409).json({ error: 'username_taken', message: 'Ese nombre de usuario ya existe.' });
        return;
      }
      const passwordHash = await hashPassword(body.password);
      const created = await deps.users.create({ username: body.username, passwordHash });
      res.status(201).json(serialize(created));
    } catch (err) {
      next(err);
    }
  });

  router.patch(
    '/:id',
    async (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) {
          res.status(400).json({ error: 'invalid_id' });
          return;
        }
        const body = updateBody.parse(req.body);

        // Guard: never let the last active account be deactivated — that
        // would lock everyone out with no way back in short of a DB console.
        if (body.active === false) {
          const others = await deps.users.countOtherActive(id);
          if (others === 0) {
            res.status(409).json({
              error: 'last_active_user',
              message: 'No puedes desactivar la última cuenta activa.',
            });
            return;
          }
        }

        const patch: { active?: boolean; passwordHash?: string } = {};
        if (body.active !== undefined) patch.active = body.active;
        if (body.password !== undefined) patch.passwordHash = await hashPassword(body.password);

        const updated = await deps.users.update(id, patch);
        if (!updated) {
          res.status(404).json({ error: 'not_found' });
          return;
        }
        res.json(serialize(updated));
      } catch (err) {
        next(err);
      }
    },
  );

  router.delete(
    '/:id',
    async (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) {
          res.status(400).json({ error: 'invalid_id' });
          return;
        }
        const others = await deps.users.countOtherActive(id);
        if (others === 0) {
          res.status(409).json({
            error: 'last_active_user',
            message: 'No puedes eliminar la última cuenta activa.',
          });
          return;
        }
        const deleted = await deps.users.delete(id);
        if (!deleted) {
          res.status(404).json({ error: 'not_found' });
          return;
        }
        res.status(204).send();
      } catch (err) {
        next(err);
      }
    },
  );

  // Surface Zod validation errors as 400.
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
