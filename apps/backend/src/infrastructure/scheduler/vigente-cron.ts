import cron, { type ScheduledTask } from 'node-cron';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { env } from '../../config/env.js';

/**
 * Daily cron scheduler for the vigente procedures scraper.
 *
 * Spawns the scraper CLI as an **isolated child process** so Playwright's
 * browser doesn't compete with the HTTP server for memory/CPU. The child
 * inherits the parent's env (DATABASE_URL, SCRAPER_* vars, etc.).
 *
 * Configure via .env:
 *   SCRAPE_CRON_ENABLED=true
 *   SCRAPE_CRON_SCHEDULE="0 6 * * *"   # 6 AM daily (default)
 *
 * The cron runs in the server's timezone (process.env.TZ or system default).
 */

let task: ScheduledTask | null = null;

export function startVigenteCron(): void {
  if (!env.SCRAPE_CRON_ENABLED) {
    console.log(
      '[cron] vigente scraper disabled (set SCRAPE_CRON_ENABLED=true to enable)',
    );
    return;
  }

  if (!cron.validate(env.SCRAPE_CRON_SCHEDULE)) {
    console.error(
      `[cron] invalid schedule expression: "${env.SCRAPE_CRON_SCHEDULE}" — skipping`,
    );
    return;
  }

  console.log(`[cron] vigente scraper scheduled: "${env.SCRAPE_CRON_SCHEDULE}"`);

  task = cron.schedule(env.SCRAPE_CRON_SCHEDULE, () => {
    void runScrape();
  });
}

export function stopVigenteCron(): void {
  if (task) {
    task.stop();
    task = null;
    console.log('[cron] vigente scraper stopped');
  }
}

/**
 * Spawn the scraper CLI as a child process and stream its output.
 * Isolated so a Playwright crash can't take down the HTTP server.
 */
function runScrape(): Promise<void> {
  return new Promise((resolvePromise) => {
    const started = new Date();
    console.log(`[cron] ▶ starting vigente scrape at ${started.toISOString()}`);

    const backendDir = resolve(process.cwd(), 'apps/backend');
    const child = spawn(
      'npx',
      ['tsx', 'src/scripts/scrape-vigentes.ts'],
      {
        cwd: backendDir,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    child.stdout?.on('data', (data: Buffer) => {
      const text = data.toString().trim();
      if (!text) return;
      // Forward summary lines to the server log.
      for (const line of text.split('\n')) {
        if (line.trim()) console.log(`[cron]   ${line}`);
      }
    });

    child.stderr?.on('data', (data: Buffer) => {
      const text = data.toString().trim();
      if (text) console.error(`[cron]   ⚠ ${text}`);
    });

    child.on('close', (code: number | null) => {
      const elapsed = ((Date.now() - started.getTime()) / 1000).toFixed(1);
      if (code === 0) {
        console.log(`[cron] ✔ vigente scrape completed in ${elapsed}s`);
      } else {
        console.error(
          `[cron] ✗ vigente scrape failed (exit ${code}) in ${elapsed}s`,
        );
      }
      resolvePromise();
    });

    child.on('error', (err: Error) => {
      console.error('[cron] ✗ failed to spawn scraper:', err.message);
      resolvePromise();
    });
  });
}
