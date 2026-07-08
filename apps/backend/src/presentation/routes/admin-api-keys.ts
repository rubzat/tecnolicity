import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import type { ApiKeyRepository, ApiKeyRecord } from '../../domain/repositories/api-key-repository.js';
import { generateApiKey, hashApiKey, keyPrefixFor } from '../../infrastructure/auth/api-key-crypto.js';
import { env } from '../../config/env.js';
import { requireAdmin } from '../middleware/require-admin.js';

const createBody = z.object({
  name: z.string().trim().min(1, 'name is required'),
  email: z.string().trim().email().optional(),
  rate_limit_per_minute: z.number().int().min(1).optional(),
});

const updateBody = z.object({
  name: z.string().trim().min(1).optional(),
  email: z.string().trim().email().nullable().optional(),
  rate_limit_per_minute: z.number().int().min(1).optional(),
  active: z.boolean().optional(),
});

/** GET/PATCH/DELETE list serialization — never includes key_hash. */
function serialize(k: ApiKeyRecord) {
  return {
    id: k.id,
    name: k.name,
    email: k.email,
    key_prefix: k.keyPrefix,
    rate_limit_per_minute: k.rateLimitPerMinute,
    active: k.active,
    last_used_at: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
    created_at: k.createdAt.toISOString(),
  };
}

/** All routes require an admin session — mounted at /api/admin/api-keys. */
export function createAdminApiKeysRouter(deps: { repository: ApiKeyRepository }): Router {
  const router = Router();
  router.use(requireAdmin);

  router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const keys = await deps.repository.list();
      res.json({ data: keys.map(serialize) });
    } catch (err) {
      next(err);
    }
  });

  // POST / — the ONLY response that ever contains the raw key. The admin
  // must copy it now; only the hash is retrievable afterwards.
  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = createBody.parse(req.body);
      const rawKey = generateApiKey();
      const created = await deps.repository.create({
        name: body.name,
        email: body.email ?? null,
        keyHash: hashApiKey(rawKey),
        keyPrefix: keyPrefixFor(rawKey),
        rateLimitPerMinute: body.rate_limit_per_minute ?? env.API_KEY_DEFAULT_RATE_LIMIT_PER_MINUTE,
      });
      res.status(201).json({ ...serialize(created), key: rawKey });
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
        const updated = await deps.repository.update(id, {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.email !== undefined ? { email: body.email } : {}),
          ...(body.rate_limit_per_minute !== undefined
            ? { rateLimitPerMinute: body.rate_limit_per_minute }
            : {}),
          ...(body.active !== undefined ? { active: body.active } : {}),
        });
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
        const deleted = await deps.repository.delete(id);
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
