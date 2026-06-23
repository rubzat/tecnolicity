import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { db, pool } from '../../../db/client.js';
import { DrizzleProcedureQueryRepository } from './procedure-query-repository.js';

/**
 * Read-only integration tests against the real Postgres+pgvector DB.
 *
 * These NEVER mutate data (the dataset is shared with the CSV load). They are
 * resilient to dataset state: they discover real rows dynamically and skip
 * gracefully if the table happens to be empty (e.g. another test truncated it).
 */
const repo = new DrizzleProcedureQueryRepository(db);

let reachable = false;
beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    reachable = true;
  } catch {
    reachable = false;
  }
});

/** Only run the body when the DB is reachable; otherwise no-op (stays green). */
const itDb = (name: string, fn: () => Promise<void>): void =>
  it(name, async () => {
    if (!reachable) return;
    await fn();
  });

/** Discover any procedure numero that has at least one contract. */
async function pickProcedureWithContracts(): Promise<string | null> {
  const rows = await db.execute(
    sql`select p.numero_procedimiento from procedures p
        where exists (select 1 from contracts c where c.procedure_id = p.id)
        limit 1`,
  );
  return (rows.rows[0] as { numero_procedimiento?: string } | undefined)?.numero_procedimiento ?? null;
}

/** Discover a tipo_contratacion value that actually occurs. */
async function pickTipoContratacion(): Promise<string | null> {
  const rows = await db.execute(
    sql`select tipo_contratacion from procedures
        where tipo_contratacion is not null group by tipo_contratacion limit 1`,
  );
  return (rows.rows[0] as { tipo_contratacion?: string } | undefined)?.tipo_contratacion ?? null;
}

describe('DrizzleProcedureQueryRepository (integration, read-only)', () => {
  itDb('lists procedures with pagination metadata', async () => {
    const page = await repo.list({}, 1, 5, 'fecha_publicacion', 'desc');
    expect(page.pagination.page).toBe(1);
    expect(page.pagination.page_size).toBe(5);
    expect(page.data.length).toBeLessThanOrEqual(5);
    expect(page.pagination.total_pages).toBe(
      page.pagination.total === 0 ? 0 : Math.ceil(page.pagination.total / 5),
    );
    if (page.pagination.total >= 5) expect(page.data.length).toBe(5);
  });

  itDb('respects page_size and advances offset', async () => {
    const first = await repo.list({}, 1, 3, 'fecha_publicacion', 'desc');
    const second = await repo.list({}, 2, 3, 'fecha_publicacion', 'desc');
    if (first.pagination.total > 3) {
      expect(second.data.length).toBeGreaterThan(0);
      const firstIds = new Set(first.data.map((d) => d.id));
      expect(second.data.every((d) => !firstIds.has(d.id))).toBe(true);
    }
  });

  itDb('returns an empty page beyond the last page (scenario 4)', async () => {
    const base = await repo.list({}, 1, 20, 'fecha_publicacion', 'desc');
    const beyond = Math.max(2, base.pagination.total_pages + 5);
    const page = await repo.list({}, beyond, 20, 'fecha_publicacion', 'desc');
    expect(page.data).toHaveLength(0);
    expect(page.pagination.total).toBe(base.pagination.total);
  });

  itDb('returns an empty result for filters matching nothing (scenario 3)', async () => {
    const page = await repo.list(
      { tipo_contratacion: 'ZZ-NO-EXISTE-9999' },
      1,
      20,
      'fecha_publicacion',
      'desc',
    );
    expect(page.data).toHaveLength(0);
    expect(page.pagination.total).toBe(0);
    expect(page.pagination.total_pages).toBe(0);
  });

  itDb('filters by a real tipo_contratacion (single-dimension, scenario 1)', async () => {
    const tipo = await pickTipoContratacion();
    if (!tipo) return;
    const filtered = await repo.list(
      { tipo_contratacion: tipo },
      1,
      50,
      'fecha_publicacion',
      'desc',
    );
    const all = await repo.list({}, 1, 1, 'fecha_publicacion', 'desc');
    expect(filtered.pagination.total).toBeLessThanOrEqual(all.pagination.total);
    expect(filtered.data.every((p) => p.tipo_contratacion === tipo)).toBe(true);
  });

  itDb('combined filters AND together (scenario 2)', async () => {
    const tipo = await pickTipoContratacion();
    if (!tipo) return;
    const onlyTipo = await repo.list(
      { tipo_contratacion: tipo },
      1,
      1,
      'fecha_publicacion',
      'desc',
    );
    const combo = await repo.list(
      { tipo_contratacion: tipo, monto_min: 1_000_000 },
      1,
      50,
      'fecha_publicacion',
      'desc',
    );
    expect(combo.pagination.total).toBeLessThanOrEqual(onlyTipo.pagination.total);
  });

  itDb('filters by amount range on contracts.importe_drc', async () => {
    const hi = await repo.list({ monto_min: 1_000_000 }, 1, 3, 'importe_total', 'desc');
    expect(hi.pagination).toBeDefined();
    // Sorting by the aggregate alias must execute without error.
    expect(hi.data.length).toBeLessThanOrEqual(3);
  });

  itDb('full-text search via q on descripcion', async () => {
    const page = await repo.list({ q: 'laboratorio' }, 1, 10, 'fecha_publicacion', 'desc');
    if (page.pagination.total > 0) {
      expect(page.data.every((p) => /laboratorio/i.test(p.descripcion ?? ''))).toBe(true);
    }
  });

  itDb('returns full detail with related entities (scenario 5)', async () => {
    const numero = await pickProcedureWithContracts();
    if (!numero) return;
    const detail = await repo.getDetail(numero);
    expect(detail).not.toBeNull();
    expect(detail!.numero_procedimiento).toBe(numero);
    expect(detail!.institucion.nombre).toBeTruthy();
    expect(detail!.unidad_compradora.clave).toBeTruthy();
    expect(Array.isArray(detail!.contracts)).toBe(true);
    expect(detail!.contracts.length).toBeGreaterThan(0);
    expect(detail!.contracts.every((c) => Array.isArray(c.amounts))).toBe(true);
  });

  itDb('returns null for an unknown procedure (PQ-5 → 404)', async () => {
    const detail = await repo.getDetail('NO-EXISTE-XYZ-123-N-99-9999');
    expect(detail).toBeNull();
  });

  itDb('computes analytics summary with non-negative totals', async () => {
    const s = await repo.summary({});
    expect(s.total_monto).toBeGreaterThanOrEqual(0);
    expect(s.total_procedimientos).toBeGreaterThanOrEqual(0);
    expect(s.total_contratos).toBeGreaterThanOrEqual(0);
    expect(s.monto_promedio).toBeGreaterThanOrEqual(0);
    const bucketSum =
      s.distribucion_montos.menor_100k +
      s.distribucion_montos.entre_100k_1m +
      s.distribucion_montos.entre_1m_10m +
      s.distribucion_montos.mayor_10m;
    expect(bucketSum).toBeLessThanOrEqual(s.total_contratos);
  });

  itDb('groups analytics by institution sorted desc by monto', async () => {
    const groups = await repo.byInstitucion({ limit: 5 });
    expect(groups.length).toBeLessThanOrEqual(5);
    for (let i = 1; i < groups.length; i++) {
      expect(groups[i]!.total_monto).toBeLessThanOrEqual(groups[i - 1]!.total_monto);
    }
  });

  itDb('groups analytics by tipo_contratacion and tipo_procedimiento (CA-2)', async () => {
    const { por_tipo_contratacion, por_tipo_procedimiento } = await repo.byTipoContratacion({});
    expect(Array.isArray(por_tipo_contratacion)).toBe(true);
    expect(Array.isArray(por_tipo_procedimiento)).toBe(true);
  });

  itDb('returns top suppliers sorted desc by total monto (CA-3)', async () => {
    const top = await repo.topProveedores({ limit: 5 });
    expect(top.length).toBeLessThanOrEqual(5);
    for (let i = 1; i < top.length; i++) {
      expect(top[i]!.total_monto).toBeLessThanOrEqual(top[i - 1]!.total_monto);
    }
  });

  itDb('analytics respect the same filters as the list (CA-6)', async () => {
    const tipo = await pickTipoContratacion();
    if (!tipo) return;
    const listPage = await repo.list(
      { tipo_contratacion: tipo },
      1,
      1,
      'fecha_publicacion',
      'desc',
    );
    const s = await repo.summary({ tipo_contratacion: tipo });
    expect(s.total_procedimientos).toBe(listPage.pagination.total);
  });

  itDb('analytics return zero-valued aggregates for an empty filter (scenario 3)', async () => {
    const s = await repo.summary({ tipo_contratacion: 'ZZ-NO-EXISTE-9999' });
    expect(s.total_monto).toBe(0);
    expect(s.total_procedimientos).toBe(0);
    expect(s.total_contratos).toBe(0);
  });
});

// Drain the shared pool so the vitest worker can exit cleanly.
afterAll(async () => {
  await pool.end();
});
