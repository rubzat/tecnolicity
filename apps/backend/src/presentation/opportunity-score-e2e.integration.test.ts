import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { eq, inArray } from 'drizzle-orm';
import { createApp } from './server.js';
import { pool, db } from '../db/client.js';
import {
  institutions,
  purchasingUnits,
  suppliers,
  procedures,
  contracts,
  vigenteProcedures,
  opportunitySegmentStats,
} from '../db/schema/index.js';
import { DrizzleOpportunityScoreRepository } from '../infrastructure/db/repositories/opportunity-score-repository.js';
import { ComputeOpportunityScores } from '../application/opportunities/compute-opportunity-scores.js';
import { computeScore } from '../application/opportunities/opportunity-score-calculator.js';

/**
 * Test end-to-end del score de oportunidad: histórico real → agregación real
 * (ComputeOpportunityScores + DrizzleOpportunityScoreRepository, igual que
 * server.ts) → persistencia en `opportunity_segment_stats` → join en
 * `GET /vigentes`.
 *
 * Fija la llave del segmento: la institución se siembra con
 * `clave_institucion` y `siglas` DELIBERADAMENTE DISTINTAS (como en los datos
 * reales: '080V26' vs 'BUAP'), y la vigente se siembra con las SIGLAS. Si la
 * agregación agrupara por `clave_institucion` el join nunca casaría y el score
 * saldría null — que es exactamente el bug que este test fija.
 */

const app = createApp();
const server = http.createServer(app);
let baseUrl = '';

const TEST_TIPO = '__TEST_E2E_TIPO__';
/** Código presupuestal de la institución — NO es lo que trae la vigente. */
const TEST_CLAVE = '__TEST_CLAVE_XYZ__';
/** Acrónimo de la institución — esto SÍ es lo que trae `vigente.siglas_dependencia`. */
const TEST_SIGLAS = '__TEST_SIGLAS_ABC__';
const VIGENTE_OK = '__TEST_E2E_VIGENTE_SIGLAS__';
const VIGENTE_DECOY = '__TEST_E2E_VIGENTE_CLAVE__';

const repository = new DrizzleOpportunityScoreRepository(db);

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
  await db.delete(vigenteProcedures).where(eq(vigenteProcedures.tipoContratacion, TEST_TIPO));
  await db.delete(opportunitySegmentStats).where(eq(opportunitySegmentStats.tipoContratacion, TEST_TIPO));
}

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });

  await cleanup();

  // --- Histórico: institución + UC + 3 procedimientos + 3 contratos ---
  const [inst] = await db
    .insert(institutions)
    .values({
      claveInstitucion: TEST_CLAVE,
      nombreInstitucion: 'Institución E2E de prueba',
      siglas: TEST_SIGLAS,
    })
    .returning();
  const [unit] = await db
    .insert(purchasingUnits)
    .values({ claveUc: `${TEST_CLAVE}-UC`, nombreUc: 'Unidad E2E', institutionId: inst!.id })
    .returning();
  const [s1] = await db.insert(suppliers).values({ rfc: `${TEST_CLAVE}-S1`, nombre: 'Proveedor 1' }).returning();
  const [s2] = await db.insert(suppliers).values({ rfc: `${TEST_CLAVE}-S2`, nombre: 'Proveedor 2' }).returning();

  const inserted = await db
    .insert(procedures)
    .values([
      { numeroProcedimiento: `${TEST_CLAVE}-P1`, tipoContratacion: TEST_TIPO, purchasingUnitId: unit!.id },
      { numeroProcedimiento: `${TEST_CLAVE}-P2`, tipoContratacion: TEST_TIPO, purchasingUnitId: unit!.id },
      { numeroProcedimiento: `${TEST_CLAVE}-P3`, tipoContratacion: TEST_TIPO, purchasingUnitId: unit!.id },
    ])
    .returning();

  // 100 + 700 (S1) vs 200 (S2) → mediana 200, 2 proveedores, dominancia 80%.
  await db.insert(contracts).values([
    { procedureId: inserted[0]!.id, supplierId: s1!.id, importeDrc: '100.00' },
    { procedureId: inserted[1]!.id, supplierId: s2!.id, importeDrc: '200.00' },
    { procedureId: inserted[2]!.id, supplierId: s1!.id, importeDrc: '700.00' },
  ]);

  // --- Vigentes: una con las SIGLAS (debe puntuar) y un señuelo con la CLAVE. ---
  await db.insert(vigenteProcedures).values([
    {
      numeroProcedimiento: VIGENTE_OK,
      tipoContratacion: TEST_TIPO,
      siglasDependencia: TEST_SIGLAS,
    },
    {
      numeroProcedimiento: VIGENTE_DECOY,
      tipoContratacion: TEST_TIPO,
      siglasDependencia: TEST_CLAVE,
    },
  ]);

  // --- Corrida real del caso de uso (mismo cableado que server.ts). ---
  const useCase = new ComputeOpportunityScores({ repository });
  await useCase.execute();
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await cleanup();
  await pool.end();
});

interface VigenteApiRow {
  numero_procedimiento: string;
  score: number | null;
  score_breakdown: {
    amount_score: number;
    competition_score: number;
    is_dominated: boolean;
    sample_size: number;
  } | null;
}

async function fetchVigentes(): Promise<VigenteApiRow[]> {
  const res = await fetch(
    `${baseUrl}/api/vigentes?tipo_contratacion=${encodeURIComponent(TEST_TIPO)}&page_size=10`,
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { data: VigenteApiRow[] };
  return body.data;
}

describe('score de oportunidad — compute → persist → join → API', () => {
  it('persiste el segmento con las SIGLAS de la institución, no con su clave', async () => {
    const bySiglas = await repository.findBySegment(TEST_TIPO, TEST_SIGLAS);
    expect(bySiglas).not.toBeNull();
    expect(bySiglas!.sampleSize).toBe(3);
    expect(bySiglas!.medianAmount).toBe(200);
    expect(bySiglas!.distinctSuppliers).toBe(2);
    expect(bySiglas!.dominantSupplierShare).toBeCloseTo(80, 1);
    expect(bySiglas!.isDominated).toBe(true);

    const byClave = await repository.findBySegment(TEST_TIPO, TEST_CLAVE);
    expect(byClave).toBeNull();
  });

  it('GET /vigentes devuelve score y score_breakdown para la vigente cuyas siglas casan', async () => {
    const data = await fetchVigentes();
    const row = data.find((r) => r.numero_procedimiento === VIGENTE_OK);

    expect(row).toBeDefined();
    expect(row!.score).not.toBeNull();
    expect(row!.score_breakdown).not.toBeNull();

    const bd = row!.score_breakdown!;
    expect(bd.sample_size).toBe(3);
    expect(bd.is_dominated).toBe(true);
    expect(bd.amount_score).toBeGreaterThanOrEqual(0);
    expect(bd.amount_score).toBeLessThanOrEqual(100);
    expect(bd.competition_score).toBeGreaterThanOrEqual(0);
    expect(bd.competition_score).toBeLessThanOrEqual(100);

    // El score expuesto es exactamente el de la fórmula aplicada al desglose
    // expuesto (los sub-scores dependen de la normalización global de la corrida).
    expect(row!.score).toBe(
      computeScore({
        amountScore: bd.amount_score,
        competitionScore: bd.competition_score,
        isDominated: bd.is_dominated,
      }).score,
    );
  });

  it('la vigente señuelo (siglas = clave_institucion) NO recibe score', async () => {
    const data = await fetchVigentes();
    const decoy = data.find((r) => r.numero_procedimiento === VIGENTE_DECOY);

    expect(decoy).toBeDefined();
    expect(decoy!.score).toBeNull();
    expect(decoy!.score_breakdown).toBeNull();
  });
});
