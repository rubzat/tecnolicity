import dotenv from 'dotenv';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '../db/schema/index.js';
import { DrizzleOpportunityScoreRepository } from '../infrastructure/db/repositories/opportunity-score-repository.js';
import { ComputeOpportunityScores } from '../application/opportunities/compute-opportunity-scores.js';

// Monorepo: .env lives at the workspace root (two levels up from apps/backend).
dotenv.config({ path: '../../.env' });

/**
 * CLI entry para recalcular el score de oportunidad (PR14).
 *
 * Uso:
 *   pnpm --filter backend compute-scores
 *
 * Env:
 *   DATABASE_URL — postgres connection string (requerida)
 *
 * En producción esto corre solo, dentro del hook `onScrapeComplete` del cron
 * del scraper — pero ese cron sólo se dispara con SCRAPE_CRON_ENABLED=true y
 * después de un scrape exitoso. Este script es el disparador manual: sirve
 * para sembrar `opportunity_segment_stats` por primera vez, para recalcular
 * después de una ingesta CSV grande, y para depurar el cálculo en dev.
 *
 * Es idempotente: agrega el histórico completo y hace upsert por segmento
 * (nunca truncate), así que se puede correr las veces que haga falta.
 */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('[compute-scores] DATABASE_URL is not set');
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: url, max: 10 });
  const db = drizzle(pool, { schema });

  const repository = new DrizzleOpportunityScoreRepository(db);
  const useCase = new ComputeOpportunityScores({ repository });

  const started = Date.now();
  console.log('[compute-scores] recalculando el score de oportunidad por segmento');

  try {
    const summary = await useCase.execute();

    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`\n[compute-scores] listo en ${elapsed}s`);
    console.log(`  segmentos evaluados: ${summary.segmentsEvaluated}`);
    console.log(`  segmentos con score: ${summary.segmentsScored}`);

    if (summary.segmentsEvaluated > 0 && summary.segmentsScored === 0) {
      console.log(
        '  (ningún segmento alcanzó el tamaño mínimo de muestra — revisa que haya contratos históricos cargados)',
      );
    }

    // Muestra las filas más frescas para que un operador pueda validar a ojo.
    const sample = await pool.query(
      `SELECT tipo_contratacion, siglas_dependencia, score, sample_size
         FROM opportunity_segment_stats
        ORDER BY created_at DESC
        LIMIT 10;`,
    );
    if (sample.rows.length > 0) {
      console.log('\n  muestra (10 segmentos más recientes):');
      for (const row of sample.rows) {
        console.log(
          `    ${String(row.siglas_dependencia).padEnd(24)} ${String(row.tipo_contratacion).padEnd(24)}  score=${String(row.score).padStart(3)}  n=${row.sample_size}`,
        );
      }
    } else {
      console.log('\n  (opportunity_segment_stats está vacía)');
    }
  } catch (err) {
    console.error('[compute-scores] failed:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[compute-scores] failed:', err);
  process.exit(1);
});
