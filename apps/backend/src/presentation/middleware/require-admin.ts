import type { Request, Response, NextFunction } from 'express';
import { verifySessionToken } from '../../infrastructure/auth/session-token.js';
import { env } from '../../config/env.js';

export const SESSION_COOKIE_NAME = 'tecnolicity_admin_session';

/** Protects `/api/admin/*` (except login). 401s with no session leak details. */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.[SESSION_COOKIE_NAME];
  const payload = typeof token === 'string' ? verifySessionToken(token, env.SESSION_SECRET) : null;
  if (!payload) {
    res.status(401).json({ error: 'unauthorized', message: 'Sesión inválida o expirada.' });
    return;
  }
  next();
}
