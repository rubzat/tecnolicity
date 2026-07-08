import { Router, type Request, type Response, type NextFunction } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { createSessionToken, verifySessionToken } from '../../infrastructure/auth/session-token.js';
import { SESSION_COOKIE_NAME, requireAdmin } from '../middleware/require-admin.js';

const loginBody = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

/** Constant-time string compare (avoids leaking password length/prefix via timing). */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // Compare against a same-length buffer first so mismatched lengths don't
  // short-circuit before timingSafeEqual (which requires equal lengths).
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

const isProd = env.NODE_ENV === 'production';

export function createAdminAuthRouter(): Router {
  const router = Router();

  router.post('/login', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { username, password } = loginBody.parse(req.body);
      const ok = safeEqual(username, env.ADMIN_USERNAME) && safeEqual(password, env.ADMIN_PASSWORD);
      if (!ok) {
        res.status(401).json({ error: 'invalid_credentials', message: 'Usuario o contraseña incorrectos.' });
        return;
      }
      const token = createSessionToken(username, env.SESSION_TTL_MS, env.SESSION_SECRET);
      res.cookie(SESSION_COOKIE_NAME, token, {
        httpOnly: true,
        secure: isProd,
        sameSite: 'lax',
        maxAge: env.SESSION_TTL_MS,
      });
      res.json({ status: 'ok' });
    } catch (err) {
      next(err);
    }
  });

  router.post('/logout', (_req: Request, res: Response) => {
    res.clearCookie(SESSION_COOKIE_NAME);
    res.json({ status: 'ok' });
  });

  // GET /admin/me — session probe for the frontend route guard. Deliberately
  // NOT behind requireAdmin: it needs to answer "no" (200 + authenticated:false)
  // rather than 401, so the SPA can tell "logged out" apart from "network error".
  router.get('/me', (req: Request, res: Response) => {
    const token = req.cookies?.[SESSION_COOKIE_NAME];
    const payload = typeof token === 'string' ? verifySessionToken(token, env.SESSION_SECRET) : null;
    res.json({ authenticated: payload !== null, username: payload?.sub ?? null });
  });

  return router;
}

export { requireAdmin };
