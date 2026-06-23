import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { env } from './config/env.js';

const app: Express = express();

app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN }));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

if (import.meta.url === `file://${process.argv[1]}`) {
  app.listen(env.PORT, () => {
    console.log(`[backend] listening on :${env.PORT} (${env.NODE_ENV})`);
  });
}

export { app };
