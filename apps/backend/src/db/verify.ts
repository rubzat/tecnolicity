import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '../../.env' });

const { Pool } = pg;

const EXPECTED_TABLES = [
  'institutions',
  'purchasing_units',
  'suppliers',
  'procedures',
  'expedientes',
  'contracts',
  'contract_amounts',
  'documents',
] as const;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();

  try {
    // 1. pgvector extension installed?
    const ext = await client.query(
      `SELECT extversion FROM pg_extension WHERE extname = 'vector'`,
    );
    if (ext.rows.length === 0) {
      console.error('[verify] FAIL: pgvector extension is not installed');
      process.exit(1);
    }
    console.log(`[verify] pgvector extension installed (v${ext.rows[0].extversion})`);

    // 2. All 8 tables present?
    const tables = await client.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    );
    const tableNames = tables.rows.map((r: { tablename: string }) => r.tablename);
    console.log(`[verify] tables in public schema (${tableNames.length}):`);
    for (const name of tableNames) {
      const mark = EXPECTED_TABLES.includes(name as (typeof EXPECTED_TABLES)[number])
        ? 'OK'
        : '  ';
      console.log(`         [${mark}] ${name}`);
    }

    const missing = EXPECTED_TABLES.filter((t) => !tableNames.includes(t));
    if (missing.length > 0) {
      console.error(`[verify] FAIL: missing tables: ${missing.join(', ')}`);
      process.exit(1);
    }

    // 3. pgvector ivfflat index on procedures.embedding exists?
    const idx = await client.query(
      `SELECT indexname FROM pg_indexes
       WHERE tablename = 'procedures' AND indexname = 'procedures_embedding_ivfflat_idx'`,
    );
    if (idx.rows.length === 0) {
      console.error('[verify] FAIL: procedures.embedding ivfflat index missing');
      process.exit(1);
    }
    console.log('[verify] procedures.embedding ivfflat index present');

    // 4. Row counts (should be 0 for a fresh schema).
    const counts = await client.query(
      `SELECT 'institutions' AS t, count(*) FROM institutions
       UNION ALL SELECT 'purchasing_units', count(*) FROM purchasing_units
       UNION ALL SELECT 'suppliers', count(*) FROM suppliers
       UNION ALL SELECT 'procedures', count(*) FROM procedures
       UNION ALL SELECT 'expedientes', count(*) FROM expedientes
       UNION ALL SELECT 'contracts', count(*) FROM contracts
       UNION ALL SELECT 'contract_amounts', count(*) FROM contract_amounts
       UNION ALL SELECT 'documents', count(*) FROM documents
       ORDER BY t`,
    );
    console.log('[verify] row counts (expect 0 everywhere before ingestion):');
    for (const row of counts.rows) {
      console.log(`         ${row.t}: ${row.count}`);
    }

    console.log('\n[verify] PASS: schema is correct.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[verify] failed:', err);
  process.exit(1);
});
