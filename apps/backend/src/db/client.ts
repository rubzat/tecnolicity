import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';
import { env } from '../config/env.js';

const { Pool } = pg;

/** Shared connection pool (max 10 conns). Reused across the API. */
const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
});

/** Drizzle ORM client bound to our schema + pool. */
export const db = drizzle(pool, { schema });

/** Low-level pool for scripts that need raw SQL (healthcheck, verification). */
export { pool };
