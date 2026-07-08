import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { createSessionToken, verifySessionToken } from '../../infrastructure/auth/session-token.js';
import { hashPassword, verifyPassword } from '../../infrastructure/auth/password.js';
import type { UserRepository } from '../../domain/repositories/user-repository.js';
import { SESSION_COOKIE_NAME } from '../middleware/require-admin.js';

const loginBody = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const isProd = env.NODE_ENV === 'production';

// Computed once at boot (not hardcoded — a malformed literal would make
// bcrypt.compare throw instead of just returning false). Used so a login
// with an unknown username still pays the same bcrypt cost as a known one
// with a wrong password, otherwise the timing difference between the two
// leaks which usernames exist.
const dummyHashPromise = hashPassword('no-such-user-timing-decoy');

export function createAdminAuthRouter(deps: { users: UserRepository }): Router {
  const router = Router();

  router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { username, password } = loginBody.parse(req.body);
      const user = await deps.users.findByUsername(username);
      const hash = user?.passwordHash ?? (await dummyHashPromise);
      const passwordOk = await verifyPassword(password, hash);
      if (!user || !user.active || !passwordOk) {
        res.status(401).json({ error: 'invalid_credentials', message: 'Usuario o contraseña incorrectos.' });
        return;
      }
      void deps.users.touchLastLogin(user.id).catch(() => {
        /* best-effort — never fail the login over it */
      });
      const token = createSessionToken(user.id, user.username, env.SESSION_TTL_MS, env.SESSION_SECRET);
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
  // Re-checks `active` (not just signature) so a deactivated account's
  // still-valid-looking cookie doesn't make the SPA think it's logged in.
  router.get('/me', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = req.cookies?.[SESSION_COOKIE_NAME];
      const payload = typeof token === 'string' ? verifySessionToken(token, env.SESSION_SECRET) : null;
      if (!payload) {
        res.json({ authenticated: false, username: null, user_id: null });
        return;
      }
      const user = await deps.users.findByUsername(payload.sub);
      const ok = user !== null && user.active && user.id === payload.uid;
      res.json({ authenticated: ok, username: ok ? user!.username : null, user_id: ok ? user!.id : null });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
