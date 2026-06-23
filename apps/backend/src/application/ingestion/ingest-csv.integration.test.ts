import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFile, rm, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { sql } from 'drizzle-orm';
import { ingestCsv } from './ingest-csv';
import { institutions } from '../../db/schema/index.js';
import { COLUMNS } from '../../infrastructure/csv/columns';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Resolve the workspace .env from this file's location (robust to vitest cwd).
const ENV_PATH = join(__dirname, '..', '..', '..', '..', '..', '.env');
dotenv.config({ path: ENV_PATH });

const FIXTURE_DIR = join(__dirname, '__fixtures__');
const FIXTURE = join(FIXTURE_DIR, 'idempotency-fixture.csv');
const QUARANTINE = join(FIXTURE_DIR, 'quarantine.jsonl');

/**
 * Integration test — idempotent ingestion against a real Postgres+pgvector DB
 * (CI-8). Self-skips when DATABASE_URL is missing or the DB is unreachable, so
 * `pnpm test` stays green in DB-less environments.
 */
const url = process.env.DATABASE_URL;
const pool = url ? new pg.Pool({ connectionString: url }) : null;

const dbAvailable = async (): Promise<boolean> => {
  if (!pool) return false;
  try {
    const c = await pool.connect();
    c.release();
    return true;
  } catch {
    return false;
  }
};

/** Build one CSV data row (properly quoted) from a partial column→value map. */
function csvRow(overrides: Partial<Record<number, string>>): string {
  const cells = new Array<string>(COLUMNS.direccionAnuncio + 1).fill('');
  for (const [k, v] of Object.entries(overrides)) {
    if (typeof v === 'string') cells[Number(k)] = v;
  }
  return cells.map((c) => `"${c.replace(/"/g, '""')}"`).join(',');
}

const HEADER =
  `"${Array.from({ length: COLUMNS.direccionAnuncio + 1 }, (_, i) => `col${i}`).join('","')}"`;

// Two procedures, one with TWO contracts (dedup test) + accented chars + mixed
// dates + null amounts. Both procedures reuse one institution / UC / supplier.
const ROWS = [
  csvRow({
    [COLUMNS.claveInstitucion]: 'INST1',
    [COLUMNS.nombreInstitucion]: 'INSTITUCIÓN NÚÑEZ',
    [COLUMNS.claveUc]: 'UC1',
    [COLUMNS.nombreUc]: 'DIRECCIÓN GÉRAL',
    [COLUMNS.numeroProcedimiento]: 'PROC-A',
    [COLUMNS.fechaPublicacion]: '2026-03-23 20:33:39', // ISO
    [COLUMNS.fechaInicio]: '24/03/2026', // DMY
    [COLUMNS.importeDrc]: '100.50',
    [COLUMNS.montoSinImpMinOriginal]: '100.50',
    [COLUMNS.rfc]: 'RFC111',
    [COLUMNS.proveedor]: 'PROVEEDOR UNO',
  }),
  // Same procedure PROC-A, second contract → tests that contracts accumulate.
  csvRow({
    [COLUMNS.claveInstitucion]: 'INST1',
    [COLUMNS.nombreInstitucion]: 'INSTITUCIÓN NÚÑEZ',
    [COLUMNS.claveUc]: 'UC1',
    [COLUMNS.numeroProcedimiento]: 'PROC-A',
    [COLUMNS.codigoContrato]: 'C-2',
    [COLUMNS.fechaInicio]: '01/04/2026',
    [COLUMNS.rfc]: 'RFC222',
    [COLUMNS.proveedor]: 'PROVEEDOR DOS',
  }),
  csvRow({
    [COLUMNS.claveInstitucion]: 'INST2',
    [COLUMNS.claveUc]: 'UC2',
    [COLUMNS.numeroProcedimiento]: 'PROC-B',
    [COLUMNS.fechaPublicacion]: '2026-02-07 00:27:02',
    [COLUMNS.importeDrc]: '5,000.25', // thousands separator
    [COLUMNS.montoSinImpMaxConvenio]: '9999.00',
    [COLUMNS.fechaFinUltimoConv]: '2026-12-31 00:00:00',
    [COLUMNS.rfc]: 'RFC111', // reuse supplier → dedup test
    [COLUMNS.proveedor]: 'PROVEEDOR UNO',
  }),
  // Malformed: missing numero_procedimiento → quarantined.
  csvRow({
    [COLUMNS.claveInstitucion]: 'INST3',
    [COLUMNS.claveUc]: 'UC3',
  }),
];

beforeAll(async () => {
  await rm(FIXTURE_DIR, { recursive: true, force: true });
  await mkdir(FIXTURE_DIR, { recursive: true });
  await writeFile(FIXTURE, [HEADER, ...ROWS].join('\n') + '\n', 'latin1');
});

afterAll(async () => {
  await rm(FIXTURE_DIR, { recursive: true, force: true });
  if (pool) await pool.end();
});

const shouldSkip = !(url && process.env.VITEST_SKIP_DB !== '1');
const run = shouldSkip ? describe.skip : describe;
run('ingest-csv (integration: idempotency)', () => {
  let ok = false;
  beforeAll(async () => {
    ok = await dbAvailable();
    if (!ok || !pool) return;
    const db = drizzle(pool, { schema: {} });
    // Clean slate.
    await db.execute(sql`TRUNCATE institutions, purchasing_units, suppliers, procedures, expedientes, contracts, contract_amounts RESTART IDENTITY CASCADE`);
  });

  it('ingests and is idempotent on re-run', async () => {
    if (!ok || !pool) return;
    const db = drizzle(pool, { schema: {} });

    const first = await ingestCsv(db, {
      csvPath: FIXTURE,
      quarantinePath: QUARANTINE,
      batchId: 'run-1',
    });

    // 4 data rows, 1 quarantined (missing numero_procedimiento).
    // NB: the quarantined row contributes NO parents (quarantine precedes dedup),
    // so INST3/UC3 on that row never reach the DB.
    expect(first.rowsRead).toBe(4);
    expect(first.quarantined).toBe(1);
    expect(first.rowsMapped).toBe(3);
    // Distinct entities: 2 institutions, 2 UCs, 2 suppliers, 2 procedures.
    expect(first.entities.institutions).toBe(2);
    expect(first.entities.purchasingUnits).toBe(2);
    expect(first.entities.suppliers).toBe(2);
    expect(first.entities.procedures).toBe(2);
    // PROC-A has 2 contracts, PROC-B has 1 → 3 contracts; 3 expedientes.
    expect(first.entities.contracts).toBe(3);
    expect(first.entities.expedientes).toBe(3);
    // Amount rows: row 1 original (1) + row 3 convenio (1) = 2.
    expect(first.entities.contractAmounts).toBe(2);

    const firstCounts = await snapshot(db);

    // --- Re-ingest the SAME data (idempotency — CI-8) ---
    const second = await ingestCsv(db, {
      csvPath: FIXTURE,
      quarantinePath: QUARANTINE,
      batchId: 'run-2',
    });
    const secondCounts = await snapshot(db);

    expect(second.entities).toEqual(first.entities);
    expect(secondCounts).toEqual(firstCounts); // zero new duplicates
  });

  it('preserves accented latin-1 characters round-trip (CI-4 encoding scenario)', async () => {
    if (!ok || !pool) return;
    const db = drizzle(pool, { schema: {} });
    const row = await db
      .select({ nombre: institutions.nombreInstitucion })
      .from(institutions)
      .where(sql`${institutions.claveInstitucion} = 'INST1'`);
    expect(row[0]?.nombre).toBe('INSTITUCIÓN NÚÑEZ');
  });

  it('enforces no duplicate natural keys', async () => {
    if (!ok || !pool) return;
    const db = drizzle(pool, { schema: {} });

    const dupProc = await db.execute(sql`
      SELECT numero_procedimiento, count(*) AS n FROM procedures
      GROUP BY numero_procedimiento HAVING count(*) > 1
    `);
    expect(dupProc.rows).toHaveLength(0);

    const dupRfc = await db.execute(sql`
      SELECT rfc, count(*) AS n FROM suppliers GROUP BY rfc HAVING count(*) > 1
    `);
    expect(dupRfc.rows).toHaveLength(0);
  });
});

async function snapshot(db: ReturnType<typeof drizzle>) {
  const rows = await db.execute(sql`
    SELECT
      (SELECT count(*) FROM institutions) AS institutions,
      (SELECT count(*) FROM purchasing_units) AS purchasing_units,
      (SELECT count(*) FROM suppliers) AS suppliers,
      (SELECT count(*) FROM procedures) AS procedures,
      (SELECT count(*) FROM expedientes) AS expedientes,
      (SELECT count(*) FROM contracts) AS contracts,
      (SELECT count(*) FROM contract_amounts) AS contract_amounts
  `);
  return rows.rows[0];
}
