import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db, pool } from '../../../db/client.js';
import {
  institutions,
  purchasingUnits,
  suppliers,
  procedures,
  contracts,
} from '../../../db/schema/index.js';
import { DrizzleOpportunityScoreRepository } from './opportunity-score-repository.js';

const repo = new DrizzleOpportunityScoreRepository(db);
const TEST_TIPO = '__TEST_TIPO_ADQUISICIONES__';
const TEST_CLAVE = `__TEST_INST_${Date.now()}__`;

async function cleanup() {
  const rows = await db
    .select({ id: procedures.id })
    .from(procedures)
    .where(eq(procedures.tipoContratacion, TEST_TIPO));
  const procedureIds = rows.map((r) => r.id);
  if (procedureIds.length > 0) {
    await db.delete(contracts).where(inArray(contracts.procedureId, procedureIds));
    await db.delete(procedures).where(inArray(procedures.id, procedureIds));
  }
  await db.delete(purchasingUnits).where(eq(purchasingUnits.claveUc, `${TEST_CLAVE}-UC`));
  await db.delete(institutions).where(eq(institutions.claveInstitucion, TEST_CLAVE));
  await db.delete(suppliers).where(inArray(suppliers.rfc, [`${TEST_CLAVE}-S1`, `${TEST_CLAVE}-S2`]));
}

beforeEach(async () => {
  await cleanup();

  const [inst] = await db
    .insert(institutions)
    .values({ claveInstitucion: TEST_CLAVE, nombreInstitucion: 'Institución de prueba', siglas: 'TEST' })
    .returning();
  const [unit] = await db
    .insert(purchasingUnits)
    .values({ claveUc: `${TEST_CLAVE}-UC`, nombreUc: 'Unidad de prueba', institutionId: inst!.id })
    .returning();
  const [s1] = await db.insert(suppliers).values({ rfc: `${TEST_CLAVE}-S1`, nombre: 'Proveedor 1' }).returning();
  const [s2] = await db.insert(suppliers).values({ rfc: `${TEST_CLAVE}-S2`, nombre: 'Proveedor 2' }).returning();

  const [p1] = await db
    .insert(procedures)
    .values({ numeroProcedimiento: `${TEST_CLAVE}-P1`, tipoContratacion: TEST_TIPO, purchasingUnitId: unit!.id })
    .returning();
  const [p2] = await db
    .insert(procedures)
    .values({ numeroProcedimiento: `${TEST_CLAVE}-P2`, tipoContratacion: TEST_TIPO, purchasingUnitId: unit!.id })
    .returning();
  const [p3] = await db
    .insert(procedures)
    .values({ numeroProcedimiento: `${TEST_CLAVE}-P3`, tipoContratacion: TEST_TIPO, purchasingUnitId: unit!.id })
    .returning();

  await db.insert(contracts).values([
    { procedureId: p1!.id, supplierId: s1!.id, importeDrc: '100.00' },
    { procedureId: p2!.id, supplierId: s2!.id, importeDrc: '200.00' },
    { procedureId: p3!.id, supplierId: s1!.id, importeDrc: '700.00' },
  ]);
});

afterAll(async () => {
  await cleanup();
  await pool.end();
});

describe('DrizzleOpportunityScoreRepository', () => {
  it('computeRawSegmentAggregates calcula mediana, tamaño de muestra, proveedores distintos y dominancia', async () => {
    const rows = await repo.computeRawSegmentAggregates();
    const segment = rows.find((r) => r.tipoContratacion === TEST_TIPO && r.siglasDependencia === TEST_CLAVE);

    expect(segment).toBeDefined();
    expect(segment!.sampleSize).toBe(3);
    expect(segment!.medianAmount).toBe(200); // 100, 200, 700 -> mediana 200
    expect(segment!.distinctSuppliers).toBe(2);
    // Proveedor 1 (S1) tiene 100+700=800 de 1000 totales -> 80%
    expect(segment!.dominantSupplierShare).toBeCloseTo(80, 1);
  });

  it('upsertSegment escribe y findBySegment lee la fila normalizada', async () => {
    await repo.upsertSegment({
      tipoContratacion: TEST_TIPO,
      siglasDependencia: TEST_CLAVE,
      sampleSize: 3,
      medianAmount: 200,
      amountScore: 55,
      distinctSuppliers: 2,
      competitionScore: 60,
      dominantSupplierShare: 80,
      isDominated: true,
      score: 33,
    });

    const found = await repo.findBySegment(TEST_TIPO, TEST_CLAVE);
    expect(found).not.toBeNull();
    expect(found!.score).toBe(33);
    expect(found!.isDominated).toBe(true);
  });

  it('upsertSegment sobre el mismo segmento actualiza en vez de duplicar', async () => {
    await repo.upsertSegment({
      tipoContratacion: TEST_TIPO,
      siglasDependencia: TEST_CLAVE,
      sampleSize: 3,
      medianAmount: 200,
      amountScore: 55,
      distinctSuppliers: 2,
      competitionScore: 60,
      dominantSupplierShare: 80,
      isDominated: true,
      score: 33,
    });
    await repo.upsertSegment({
      tipoContratacion: TEST_TIPO,
      siglasDependencia: TEST_CLAVE,
      sampleSize: 4,
      medianAmount: 250,
      amountScore: 60,
      distinctSuppliers: 3,
      competitionScore: 50,
      dominantSupplierShare: 70,
      isDominated: true,
      score: 56,
    });

    const found = await repo.findBySegment(TEST_TIPO, TEST_CLAVE);
    expect(found!.sampleSize).toBe(4);
    expect(found!.score).toBe(56);
  });

  it('findBySegment devuelve null para un segmento inexistente', async () => {
    expect(await repo.findBySegment('__NO_EXISTE__', '__NO_EXISTE__')).toBeNull();
  });
});
