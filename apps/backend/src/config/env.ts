import dotenv from 'dotenv';
import { z } from 'zod';

// Monorepo: .env lives at the workspace root (two levels up from apps/backend).
dotenv.config({ path: '../../.env' });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  EMBEDDING_DIM: z.coerce.number().int().min(1).default(1536),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:');
  console.error(parsed.error.flatten().fieldErrors);
  throw new Error(`Environment validation failed: ${parsed.error.message}`);
}

export const env = parsed.data;
export type Env = typeof env;
