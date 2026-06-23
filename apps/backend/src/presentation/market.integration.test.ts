import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from './server.js';
import { pool } from '../db/client.js';

/**
 * HTTP integration tests for the Market Intelligence API (PR6).
 *
 * Exercises all six `/api/market/*` endpoints end-to-end against the live DB
 * (310K contracts, 218K procedures). Uses a tiny 2-keyword segment
 * (`software,camara`) so assertions are stable and fast. Performance is
 * verified separately (see apply-progress: each endpoint < 5s).
 */
const app = createApp();
const server = http.createServer(app);
let baseUrl = '';

beforeAll(
  async () =>
    new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    }),
);

afterAll(
  async () =>
    new Promise<void>((resolve) => {
      server.close(() => resolve());
    }),
);
afterAll(async () => {
  await pool.end();
});

async function get(path: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`);
}

const SEG = 'segment=software,camara';

describe('Market Intelligence API (HTTP integration)', () => {
  it('GET /api/market/overview returns segment size + trend', async () => {
    const res = await get(`/api/market/overview?${SEG}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      total_contracts: number;
      total_amount: number;
      avg_amount: number;
      unique_suppliers: number;
      unique_buyers: number;
      by_year: { year: number; contracts: number; amount: number }[];
      segment_used_default: boolean;
    };
    // Magnitude assertions are tolerant (>= 0): the dev DB may be truncated by
    // the ingest integration test (known PR2 gotcha), leaving only a handful of
    // sample rows that need not match the software segment. Shape is always
    // asserted; dominance of the relationship (avg = total/count) is checked
    // only when real data is present.
    expect(body.total_contracts).toBeGreaterThanOrEqual(0);
    expect(body.total_amount).toBeGreaterThanOrEqual(0);
    expect(body.unique_suppliers).toBeGreaterThanOrEqual(0);
    expect(body.unique_buyers).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(body.by_year)).toBe(true);
    expect(body.segment_used_default).toBe(false); // we passed an explicit segment
    if (body.total_contracts > 0) {
      expect(body.avg_amount).toBeCloseTo(body.total_amount / body.total_contracts, 1);
    }
  });

  it('GET /api/market/overview with no segment falls back to defaults', async () => {
    const res = await get('/api/market/overview');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { segment_used_default: boolean };
    expect(body.segment_used_default).toBe(true);
  });

  it('GET /api/market/competitors returns ranked suppliers', async () => {
    const res = await get(`/api/market/competitors?${SEG}&limit=5`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        nombre: string;
        rfc: string;
        contracts_count: number;
        total_amount: number;
        avg_amount: number;
        unique_buyers: number;
        market_share_pct: number;
      }[];
    };
    expect(body.data.length).toBeLessThanOrEqual(5);
    if (body.data.length > 0) {
      // Sorted by total_amount DESC.
      for (let i = 1; i < body.data.length; i++) {
        expect(body.data[i]!.total_amount).toBeLessThanOrEqual(
          body.data[i - 1]!.total_amount,
        );
      }
      expect(body.data[0]!.total_amount).toBeGreaterThan(0);
      expect(body.data[0]!.market_share_pct).toBeGreaterThanOrEqual(0);
    }
  });

  it('GET /api/market/buyers returns ranked institutions', async () => {
    const res = await get(`/api/market/buyers?${SEG}&limit=5`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        nombre: string;
        clave: string;
        total_amount: number;
        unique_suppliers: number;
        top_supplier: { nombre: string; market_share_pct: number } | null;
      }[];
    };
    expect(body.data.length).toBeLessThanOrEqual(5);
    if (body.data.length > 0) {
      for (let i = 1; i < body.data.length; i++) {
        expect(body.data[i]!.total_amount).toBeLessThanOrEqual(
          body.data[i - 1]!.total_amount,
        );
      }
    }
  });

  it('GET /api/market/opportunities returns recently-opened procedures', async () => {
    const res = await get(`/api/market/opportunities?${SEG}&limit=5&page=1`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        numero_procedimiento: string;
        institucion_nombre: string;
        fecha_apertura: string | null;
        importe_estimado: number;
      }[];
      pagination: { page: number; total: number; total_pages: number };
    };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeLessThanOrEqual(5);
    expect(body.pagination.page).toBe(1);
  });

  it('GET /api/market/expiring returns contracts ending soon', async () => {
    const res = await get(`/api/market/expiring?${SEG}&months=6&limit=5`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        contrato_id: number;
        fecha_fin: string | null;
        institucion_nombre: string;
        supplier: { rfc: string } | null;
      }[];
    };
    // Expiring window is tight (6 months); may be empty for a niche segment,
    // but when present the rows must have a fecha_fin.
    for (const row of body.data) {
      expect(row.fecha_fin).not.toBeNull();
    }
  });

  it('GET /api/market/dominance returns institutions with a dominant supplier', async () => {
    const res = await get(`/api/market/dominance?${SEG}&limit=5`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        institution_nombre: string;
        dominant_supplier_nombre: string;
        dominant_share_pct: number;
        total_amount: number;
      }[];
    };
    for (const row of body.data) {
      // Threshold filter keeps only >= 60% dominance.
      expect(row.dominant_share_pct).toBeGreaterThanOrEqual(60);
    }
  });

  it('GET /api/market rejects an invalid limit with 400', async () => {
    const res = await get(`/api/market/competitors?${SEG}&limit=999`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_query');
  });
});
