import dotenv from 'dotenv';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { ingestCsv } from '../application/ingestion/ingest-csv';

// Monorepo: .env lives at the workspace root (two levels up from apps/backend).
dotenv.config({ path: '../../.env' });

/**
 * CLI entry for CSV ingestion.
 *
 * Usage:
 *   pnpm --filter backend ingest                              # default file
 *   pnpm --filter backend ingest -- data/file_2024.csv        # single file
 *   pnpm --filter backend ingest -- data/file_2024.csv data/file_2025.csv  # multiple
 *   pnpm --filter backend ingest -- data/                     # all CSVs in a directory
 *
 * Env:
 *   DATABASE_URL  — postgres connection string (required)
 *   CSV_PATH      — default CSV location (optional; args override)
 *   QUARANTINE_PATH — where to write the JSONL quarantine log (default ./quarantine.jsonl)
 *
 * Does NOT truncate: re-running on the same file proves idempotency (CI-8).
 * Multiple files are ingested sequentially; idempotency prevents duplicates.
 */

import { readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const DEFAULT_CSV =
  process.env.CSV_PATH ?? '../../data/contratos_comprasmx_2026.csv';
const QUARANTINE_PATH = process.env.QUARANTINE_PATH ?? './quarantine.jsonl';

/** Expand CLI args into a list of CSV file paths (dirs → all .csv inside). */
function resolveCsvPaths(args: string[]): string[] {
  const clean = args.filter((a) => a !== '--');
  if (clean.length === 0) return [DEFAULT_CSV];

  const paths: string[] = [];
  for (const resolved of clean) {
    let stats;
    try {
      stats = statSync(resolved);
    } catch {
      console.error(`[ingest] path not found: ${resolved}`);
      process.exit(1);
    }
    if (stats.isDirectory()) {
      const csvs = readdirSync(resolved)
        .filter((f) => f.toLowerCase().endsWith('.csv'))
        .sort()
        .map((f) => join(resolved, f));
      if (csvs.length === 0) {
        console.warn(`[ingest] no .csv files found in directory: ${resolved}`);
      }
      paths.push(...csvs);
    } else {
      paths.push(resolved);
    }
  }
  return paths;
}

async function main() {
  const csvPaths = resolveCsvPaths(process.argv.slice(2));
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('[ingest] DATABASE_URL is not set');
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: url, max: 10 });
  const db = drizzle(pool);

  const totalStarted = Date.now();
  console.log(`[ingest] starting ingestion — ${csvPaths.length} file(s)`);

  for (const [idx, csvPath] of csvPaths.entries()) {
    const i = idx + 1;
    const fileStarted = Date.now();
    console.log(`\n[ingest] [${i + 1}/${csvPaths.length}] ${csvPath}`);
    console.log(`[ingest]   quarantine:  ${QUARANTINE_PATH}`);

    const summary = await ingestCsv(db, {
      csvPath,
      quarantinePath: QUARANTINE_PATH,
      onProgress: (processed, quarantined) => {
        const secs = ((Date.now() - fileStarted) / 1000).toFixed(1);
        console.log(
          `[ingest]   progress: ${processed.toLocaleString()} rows processed, ${quarantined} quarantined (${secs}s)`,
        );
      },
    });

    const elapsed = ((Date.now() - fileStarted) / 1000).toFixed(1);
    console.log(`\n[ingest] [${i + 1}/${csvPaths.length}] done in ${elapsed}s`);
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
  }

  const totalElapsed = ((Date.now() - totalStarted) / 1000).toFixed(1);
  console.log(`\n[ingest] all files done in ${totalElapsed}s`);

  await pool.end();
}

main().catch((err) => {
  console.error('[ingest] failed:', err);
  process.exit(1);
});
