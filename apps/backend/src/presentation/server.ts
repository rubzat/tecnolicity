import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import helmet from 'helmet';
import cors from 'cors';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { env } from '../config/env.js';
import { db, pool } from '../db/client.js';
import * as schema from '../db/schema/index.js';
import { DrizzleProcedureQueryRepository } from '../infrastructure/db/repositories/procedure-query-repository.js';
import { ListProcedures } from '../application/queries/list-procedures.js';
import { GetProcedureDetail } from '../application/queries/get-procedure-detail.js';
import { ComputeAnalytics } from '../application/queries/compute-analytics.js';
import { createProceduresRouter } from './routes/procedures.js';
import { createAnalyticsRouter } from './routes/analytics.js';

type Db = NodePgDatabase<typeof schema>;

/**
 * Build the Express application. Dependency wiring happens here (composition
 * root): Drizzle repository → use cases → routers. `dbClient` is injectable so
 * tests can supply a custom connection; production uses the shared pool.
 */
export function createApp(dbClient: Db = db): Express {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN }));
  app.use(express.json());

  // Composition root
  const repo = new DrizzleProcedureQueryRepository(dbClient);
  const list = new ListProcedures(repo);
  const detail = new GetProcedureDetail(repo);
  const analytics = new ComputeAnalytics(repo);

  // Health check (also serves as the DB liveness probe).
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  // Routes — all mounted under /api (design REST contract).
  app.use('/api/procedures', createProceduresRouter({ list, detail }));
  app.use('/api/analytics', createAnalyticsRouter({ analytics }));

  // 404 for unknown /api routes.
  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'not_found' });
  });

  // Centralized error handler — converts unhandled errors to 500 JSON.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[server] unhandled error:', err);
    res.status(500).json({ error: 'internal_error' });
  });

  return app;
}

/** Start listening. Call once from the process entry point. */
export function startServer(): { app: Express; close: () => Promise<void> } {
  const app = createApp();
  const server = app.listen(env.PORT, () => {
    console.log(`[backend] listening on :${env.PORT} (${env.NODE_ENV})`);
  });
  return {
    app,
    close: async () => {
      server.close();
      await pool.end();
    },
  };
}
