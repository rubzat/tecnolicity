import type { Request, Response, NextFunction } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { ApiKeyRepository } from '../../domain/repositories/api-key-repository.js';
import { hashApiKey } from '../../infrastructure/auth/api-key-crypto.js';
import { env } from '../../config/env.js';

const API_KEY_HEADER = 'x-api-key';

interface ResolvedApiKey {
  id: number;
  rateLimitPerMinute: number;
}

/** Typed accessor for `res.locals.apiKey` (avoids augmenting Express's global
 * Locals type, which pnpm's node_modules layout doesn't reliably resolve). */
function getResolvedApiKey(res: Response): ResolvedApiKey | null {
  return (res.locals as { apiKey?: ResolvedApiKey | null }).apiKey ?? null;
}

function setResolvedApiKey(res: Response, value: ResolvedApiKey | null): void {
  (res.locals as { apiKey?: ResolvedApiKey | null }).apiKey = value;
}

/**
 * Resolves `X-API-Key` (if present) to an active key record before the rate
 * limiter runs, so it can grant that key's own limit instead of the public
 * baseline. An unknown/inactive/missing key just falls through to public
 * behavior — this never rejects the request itself (PR11: keys widen access,
 * they don't gate it).
 */
export function apiKeyLookup(repo: ApiKeyRepository) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const raw = req.header(API_KEY_HEADER);
    if (!raw) {
      setResolvedApiKey(res, null);
      next();
      return;
    }
    try {
      const record = await repo.findByHash(hashApiKey(raw));
      if (record && record.active) {
        setResolvedApiKey(res, { id: record.id, rateLimitPerMinute: record.rateLimitPerMinute });
        void repo.touchLastUsed(record.id).catch(() => {
          /* best-effort telemetry — never fail the request over it */
        });
      } else {
        setResolvedApiKey(res, null);
      }
    } catch {
      setResolvedApiKey(res, null);
    }
    next();
  };
}

/**
 * Public-API rate limiter. Baseline is per-IP; a resolved API key gets its
 * own bucket (keyed by key id, not IP) at its configured limit, so callers
 * behind a shared/corporate IP don't share one bucket once they have a key.
 */
export const publicRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: (req: Request, res: Response) => getResolvedApiKey(res)?.rateLimitPerMinute ?? env.PUBLIC_RATE_LIMIT_PER_MINUTE,
  keyGenerator: (req: Request, res: Response) => {
    const key = getResolvedApiKey(res);
    return key ? `key:${key.id}` : ipKeyGenerator(req.ip ?? 'unknown');
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited', message: 'Demasiadas solicitudes. Intenta de nuevo en un minuto.' },
});
