import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { eq } from 'drizzle-orm';
import { createApp } from './server.js';
import { pool, db } from '../db/client.js';
import { vigenteProcedures, opportunitySegmentStats } from '../db/schema/index.js';

const app = createApp();
const server = http.createServer(app);
let baseUrl = '';

const TEST_TIPO = '__TEST_SCORE_TIPO__';
const TEST_SIGLAS = '__TEST_SCORE_SIGLAS__';

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.delete(vigenteProcedures).where(eq(vigenteProcedures.tipoContratacion, TEST_TIPO));
  await db.delete(opportunitySegmentStats).where(eq(opportunitySegmentStats.tipoContratacion, TEST_TIPO));
  await pool.end();
});

beforeEach(async () => {
  await db.delete(vigenteProcedures).where(eq(vigenteProcedures.tipoContratacion, TEST_TIPO));
  await db.delete(opportunitySegmentStats).where(eq(opportunitySegmentStats.tipoContratacion, TEST_TIPO));

  await db.insert(opportunitySegmentStats).values({
    tipoContratacion: TEST_TIPO,
    siglasDependencia: TEST_SIGLAS,
    sampleSize: 5,
    medianAmount: '1000.00',
    amountScore: 80,
    distinctSuppliers: 2,
    competitionScore: 70,
    dominantSupplierShare: '10.00',
    isDominated: false,
    score: 76,
  });

  await db.insert(vigenteProcedures).values([
    {
      numeroProcedimiento: '__TEST_SCORE_CON_MATCH__',
      tipoContratacion: TEST_TIPO,
      siglasDependencia: TEST_SIGLAS,
    },
    {
      numeroProcedimiento: '__TEST_SCORE_SIN_MATCH__',
      tipoContratacion: TEST_TIPO,
      siglasDependencia: '__TEST_SIGLAS_SIN_SEGMENTO__',
    },
  ]);
});

async function get(path: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`);
}

describe('GET /vigentes — score de oportunidad', () => {
  it('incluye score y score_breakdown cuando el segmento tiene datos', async () => {
    const res = await get(`/api/vigentes?q=${encodeURIComponent('__TEST_SCORE_CON_MATCH__')}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { numero_procedimiento: string; score: number | null; score_breakdown: unknown }[] };
    const row = body.data.find((r) => r.numero_procedimiento === '__TEST_SCORE_CON_MATCH__');
    expect(row).toBeDefined();
    expect(row!.score).toBe(76);
    expect(row!.score_breakdown).toEqual({
      amount_score: 80,
      competition_score: 70,
      is_dominated: false,
      sample_size: 5,
    });
  });

  it('score y score_breakdown son null cuando el segmento no tiene datos', async () => {
    const res = await get(`/api/vigentes?q=${encodeURIComponent('__TEST_SCORE_SIN_MATCH__')}`);
    const body = (await res.json()) as { data: { numero_procedimiento: string; score: number | null; score_breakdown: unknown }[] };
    const row = body.data.find((r) => r.numero_procedimiento === '__TEST_SCORE_SIN_MATCH__');
    expect(row).toBeDefined();
    expect(row!.score).toBeNull();
    expect(row!.score_breakdown).toBeNull();
  });

  it('sort=score ordena descendente y NULLS LAST', async () => {
    const res = await get(`/api/vigentes?tipo_contratacion=${encodeURIComponent(TEST_TIPO)}&sort=score&page_size=10`);
    const body = (await res.json()) as { data: { numero_procedimiento: string; score: number | null }[] };
    const numeros = body.data.map((r) => r.numero_procedimiento);
    expect(numeros.indexOf('__TEST_SCORE_CON_MATCH__')).toBeLessThan(numeros.indexOf('__TEST_SCORE_SIN_MATCH__'));
  });
});
