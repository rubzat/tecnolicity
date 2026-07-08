import type { Request, Response, NextFunction } from 'express';
import { verifySessionToken } from '../../infrastructure/auth/session-token.js';
import type { UserRepository } from '../../domain/repositories/user-repository.js';
import { env } from '../../config/env.js';

export const SESSION_COOKIE_NAME = 'tecnolicity_admin_session';

export interface CurrentUser {
  id: number;
  username: string;
}

/** Typed accessor for `res.locals.currentUser`, set by requireAdmin. */
export function getCurrentUser(res: Response): CurrentUser | null {
  return (res.locals as { currentUser?: CurrentUser | null }).currentUser ?? null;
}

/**
 * Protects `/api/admin/*` (except login/me). Verifies the session signature
 * AND re-checks the user is still active on every request — a stale-but-
 * validly-signed cookie from a since-deactivated account is rejected
 * immediately rather than staying valid until it expires.
 */
export function createRequireAdmin(users: UserRepository) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const token = req.cookies?.[SESSION_COOKIE_NAME];
    const payload = typeof token === 'string' ? verifySessionToken(token, env.SESSION_SECRET) : null;
    if (!payload) {
      res.status(401).json({ error: 'unauthorized', message: 'Sesión inválida o expirada.' });
      return;
    }
    const user = await users.findByUsername(payload.sub);
    if (!user || !user.active || user.id !== payload.uid) {
      res.status(401).json({ error: 'unauthorized', message: 'Sesión inválida o expirada.' });
      return;
    }
    (res.locals as { currentUser?: CurrentUser }).currentUser = { id: user.id, username: user.username };
    next();
  };
}
