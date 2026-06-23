import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { ingestCsv } from '../application/ingestion/ingest-csv';

/**
 * CLI entry for CSV ingestion.
 *
 * Usage:
 *   pnpm --filter backend ingest
 *   pnpm --filter backend ingest -- /path/to/file.csv
 *
 * Env:
 *   DATABASE_URL  — postgres connection string (required)
 *   CSV_PATH      — default CSV location (optional; arg overrides)
 *   QUARANTINE_PATH — where to write the JSONL quarantine log (default ./quarantine.jsonl)
 *
 * Does NOT truncate: re-running on the same file proves idempotency (CI-8).
 */

const DEFAULT_CSV =
  process.env.CSV_PATH ?? '../../data/contratos_comprasmx_2026.csv';
const QUARANTINE_PATH = process.env.QUARANTINE_PATH ?? './quarantine.jsonl';

async function main() {
  const csvPath = process.argv[2] ?? DEFAULT_CSV;
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('[ingest] DATABASE_URL is not set');
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: url, max: 10 });
  const db = drizzle(pool);

  const started = Date.now();
  console.log(`[ingest] starting ingestion`);
  console.log(`[ingest]   csv:         ${csvPath}`);
  console.log(`[ingest]   quarantine:  ${QUARANTINE_PATH}`);

  const summary = await ingestCsv(db, {
    csvPath,
    quarantinePath: QUARANTINE_PATH,
    onProgress: (processed, quarantined) => {
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      console.log(
        `[ingest]   progress: ${processed.toLocaleString()} rows processed, ${quarantined} quarantined (${secs}s)`,
      );
    },
  });

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\n[ingest] done in ${elapsed}s`);
  console.log(`  rows read:        ${summary.rowsRead.toLocaleString()}`);
  console.log(`  rows mapped:      ${summary.rowsMapped.toLocaleString()}`);
  console.log(`  quarantined:      ${summary.quarantined.toLocaleString()}`);
  console.log(`  batch id:         ${summary.batchId}`);
  console.log(`  entities:`);
  console.log(`    institutions:     ${summary.entities.institutions.toLocaleString()}`);
  console.log(`    purchasing_units: ${summary.entities.purchasingUnits.toLocaleString()}`);
  console.log(`    suppliers:        ${summary.entities.suppliers.toLocaleString()}`);
  console.log(`    procedures:       ${summary.entities.procedures.toLocaleString()}`);
  console.log(`    expedientes:      ${summary.entities.expedientes.toLocaleString()}`);
  console.log(`    contracts:        ${summary.entities.contracts.toLocaleString()}`);
  console.log(`    contract_amounts: ${summary.entities.contractAmounts.toLocaleString()}`);

  if (summary.quarantined > 0) {
    console.log(`\n  quarantine reasons (top):`);
    const reasons = Object.entries(summary.reasons)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    for (const [reason, n] of reasons) console.log(`    ${n.toLocaleString()}  ${reason}`);
    console.log(`  (see ${QUARANTINE_PATH} for the full list)`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error('[ingest] failed:', err);
  process.exit(1);
});
