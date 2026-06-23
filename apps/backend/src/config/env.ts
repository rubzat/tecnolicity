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

  // --- Document fetching (Phase 5) -----------------------------------------
  // Feature flag: disable the whole worker if reCAPTCHA degrades (design risk).
  DOCS_FETCH_ENABLED: z.coerce.boolean().default(true),
  // Concurrency cap for Playwright page loads (DF-5). 1 = serialize.
  DOCS_FETCH_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(1),
  // Delay (ms) between page loads — don't hammer the government source.
  DOCS_FETCH_DELAY_MS: z.coerce.number().int().min(0).default(2000),
  // Max wall-clock time for a single fetch (per-procedure timeout).
  DOCS_FETCH_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30_000),
  // Local document storage root (relative to apps/backend). .gitignored.
  STORAGE_PATH: z.string().default('./storage'),
  // Start headless; if reCAPTCHA blocks, retry once non-headless (#213).
  DOCS_FETCH_HEADLESS_FALLBACK: z.coerce.boolean().default(true),

  // --- Vigente scraper (PR7) -----------------------------------------------
  // Maximum result pages to scrape per run (safety cap). The API reports the
  // true page count; we stop at whichever is smaller.
  SCRAPER_MAX_PAGES: z.coerce.number().int().min(1).default(50),
  // Delay (ms) between page loads — respect the government source.
  SCRAPER_DELAY_MS: z.coerce.number().int().min(0).default(2000),
  // Per-page navigation + settle timeout.
  SCRAPER_TIMEOUT_MS: z.coerce.number().int().min(5000).default(45_000),
  // Page size requested from the API (max observed working = 100).
  SCRAPER_PAGE_SIZE: z.coerce.number().int().min(1).max(100).default(100),

  // --- Vigente cron scheduler ----------------------------------------------
  // Feature flag: enable/disable the daily automatic scrape.
  SCRAPE_CRON_ENABLED: z.coerce.boolean().default(false),
  // Cron expression (standard 5-field). Default: 6:00 AM every day.
  SCRAPE_CRON_SCHEDULE: z.string().default('0 6 * * *'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:');
  console.error(parsed.error.flatten().fieldErrors);
  throw new Error(`Environment validation failed: ${parsed.error.message}`);
}

export const env = parsed.data;
export type Env = typeof env;
