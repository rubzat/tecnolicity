import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from './server.js';
import { pool } from '../db/client.js';

/**
 * HTTP integration tests for the Product Price Intelligence API (PR10).
 *
 * Exercises all four `/api/products/*` endpoints end-to-end against the live
 * DB (312K contracts, 60K suppliers, multi-year).
 *
 * TOLERANCE NOTE (mirrors market/suppliers integration tests): the ingest
 * integration test truncates the shared dev DB (gotcha #228), so the suites
 * race. Every assertion validates SHAPE + invariants unconditionally; magnitude
 * assertions run ONLY when real data is present (detected via a presence probe
 * using the 'software' keyword, which is in the default segment set).
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

/** Probe whether the real dataset is loaded (software returns priced rows). */
async function hasRealData(): Promise<boolean> {
  const res = await get('/api/products/price-history?q=software&group_by=year');
  if (!res.ok) return false;
  const body = (await res.json()) as { overall: { total_contracts: number } };
  return body.overall.total_contracts > 0;
}

describe('Product Price Intelligence API (HTTP integration)', () => {
  it('GET /api/products/price-history returns periods + overall + trend', async () => {
    const real = await hasRealData();
    const res = await get('/api/products/price-history?q=software&group_by=year');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      periods: {
        period: string;
        contracts: number;
        avg_price: number;
        min_price: number;
        max_price: number;
        median_price: number;
        total_amount: number;
        stddev: number;
      }[];
      overall: {
        total_contracts: number;
        avg_price: number;
        min_price: number;
        max_price: number;
        median_price: number;
        total_amount: number;
      };
      trend: 'increasing' | 'decreasing' | 'stable';
    };

    expect(Array.isArray(body.periods)).toBe(true);
    expect(['increasing', 'decreasing', 'stable']).toContain(body.trend);

    // Periods are lexicographically ascending (sortable chronologically).
    for (let i = 1; i < body.periods.length; i++) {
      expect(body.periods[i]!.period >= body.periods[i - 1]!.period).toBe(true);
    }
    // avg/min/max invariants per period.
    for (const p of body.periods) {
      expect(p.contracts).toBeGreaterThan(0);
      expect(p.min_price).toBeLessThanOrEqual(p.avg_price);
      expect(p.max_price).toBeGreaterThanOrEqual(p.avg_price);
      expect(p.total_amount).toBeGreaterThanOrEqual(0);
      expect(p.stddev).toBeGreaterThanOrEqual(0);
    }
    // overall mirrors the union of periods.
    if (body.periods.length > 0) {
      expect(body.overall.total_contracts).toBe(
        body.periods.reduce((acc, p) => acc + p.contracts, 0),
      );
    }
    if (real) {
      expect(body.overall.total_contracts).toBeGreaterThan(0);
    }
  });

  it('GET /api/products/price-history supports quarter and month granularities', async () => {
    for (const groupBy of ['quarter', 'month'] as const) {
      const res = await get(`/api/products/price-history?q=software&group_by=${groupBy}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { periods: { period: string }[] };
      // Quarter format: "YYYY-Qn"; month format: "YYYY-MM".
      if (body.periods.length > 0) {
        const sample = body.periods[0]!.period;
        if (groupBy === 'quarter') expect(sample).toMatch(/^\d{4}-Q[1-4]$/);
        if (groupBy === 'month') expect(sample).toMatch(/^\d{4}-\d{2}$/);
      }
    }
  });

  it('GET /api/products/price-history rejects an invalid group_by with 400', async () => {
    const res = await get('/api/products/price-history?q=software&group_by=decade');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_query');
  });

  it('GET /api/products/distribution returns 6 fixed buckets in order', async () => {
    const res = await get('/api/products/distribution?q=software');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      buckets: { range: string; label: string; count: number }[];
    };
    expect(body.buckets).toHaveLength(6);
    expect(body.buckets.map((b) => b.range)).toEqual([
      '< 10K',
      '10K-100K',
      '100K-1M',
      '1M-10M',
      '10M-100M',
      '>100M',
    ]);
    for (const b of body.buckets) {
      expect(b.count).toBeGreaterThanOrEqual(0);
      expect(b.label.length).toBeGreaterThan(0);
    }
  });

  it('GET /api/products/suppliers returns ranked suppliers sorted by total_amount DESC', async () => {
    const real = await hasRealData();
    const res = await get('/api/products/suppliers?q=software&limit=5');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      suppliers: {
        nombre: string;
        rfc: string;
        contracts: number;
        avg_price: number;
        min_price: number;
        max_price: number;
        total_amount: number;
      }[];
    };
    expect(body.suppliers.length).toBeLessThanOrEqual(5);
    for (let i = 1; i < body.suppliers.length; i++) {
      expect(body.suppliers[i]!.total_amount).toBeLessThanOrEqual(
        body.suppliers[i - 1]!.total_amount,
      );
    }
    for (const s of body.suppliers) {
      expect(s.contracts).toBeGreaterThan(0);
      expect(s.min_price).toBeLessThanOrEqual(s.avg_price);
      expect(s.max_price).toBeGreaterThanOrEqual(s.avg_price);
    }
    if (real) expect(body.suppliers.length).toBeGreaterThan(0);
  });

  it('GET /api/products/suppliers caps limit at 50', async () => {
    const res = await get('/api/products/suppliers?q=software&limit=999');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_query');
  });

  it('GET /api/products/top-contracts returns paginated rows sorted by amount DESC', async () => {
    const res = await get('/api/products/top-contracts?q=software&page=1&page_size=5');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        numero_procedimiento: string;
        importe_drc: number;
        supplier_nombre: string | null;
        institucion_nombre: string;
      }[];
      pagination: { page: number; page_size: number; total: number; total_pages: number };
    };
    expect(body.pagination.page).toBe(1);
    expect(body.data.length).toBeLessThanOrEqual(5);
    for (let i = 1; i < body.data.length; i++) {
      expect(body.data[i]!.importe_drc).toBeLessThanOrEqual(body.data[i - 1]!.importe_drc);
    }
  });

  it('GET /api/products/top-contracts accepts limit as a page_size alias', async () => {
    const res = await get('/api/products/top-contracts?q=software&limit=3&page=1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: unknown[];
      pagination: { page_size: number };
    };
    // The alias takes precedence over the default page_size=20.
    expect(body.data.length).toBeLessThanOrEqual(3);
  });

  it('rejects a query with no keywords (empty / whitespace-only) with 400', async () => {
    // Absent q.
    let res = await get('/api/products/price-history?group_by=year');
    expect(res.status).toBe(400);
    // q with only commas/whitespace → splits to empty keyword list.
    res = await get('/api/products/price-history?q=,,%20%20,');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_query');
  });
});
