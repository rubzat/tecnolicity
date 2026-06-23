import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from './server.js';
import { pool } from '../db/client.js';

/**
 * HTTP-level integration tests: start the real Express app on an ephemeral port
 * and exercise the endpoints end-to-end against the live DB (Node global fetch).
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

// Drain the shared pool so the vitest worker exits cleanly.
afterAll(async () => {
  await pool.end();
});

async function get(path: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`);
}

describe('API (HTTP integration)', () => {
  it('GET /api/health → 200 ok', async () => {
    const res = await get('/api/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('ok');
  });

  it('GET /api/procedures paginates and returns the contract shape', async () => {
    const res = await get('/api/procedures?page=1&page_size=5');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: unknown[];
      pagination: { page: number; page_size: number; total: number; total_pages: number };
    };
    expect(body.data.length).toBeLessThanOrEqual(5);
    expect(body.pagination.page).toBe(1);
    expect(body.pagination.page_size).toBe(5);
  });

  it('GET /api/procedures?tipo_contratacion filters results', async () => {
    const res = await get('/api/procedures?tipo_contratacion=ADQUISICIONES&page_size=3');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { tipo_contratacion: string }[] };
    expect(body.data.every((p) => p.tipo_contratacion === 'ADQUISICIONES')).toBe(true);
  });

  it('GET /api/procedures?monto_min filters by amount range', async () => {
    const res = await get('/api/procedures?monto_min=1000000&page_size=3');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { importe_total: number }[] };
    expect(body.data.every((p) => p.importe_total >= 0)).toBe(true);
  });

  it('GET /api/procedures?q= runs full-text search', async () => {
    const res = await get('/api/procedures?q=laboratorio&page_size=3');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { descripcion: string | null }[] };
    if (body.data.length > 0) {
      expect(body.data.every((p) => /laboratorio/i.test(p.descripcion ?? ''))).toBe(true);
    }
  });

  it('GET /api/procedures/:numero returns 404 for an unknown procedure', async () => {
    const res = await get('/api/procedures/NO-EXISTE-123');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('not_found');
  });

  it('GET /api/procedures/:numero returns full detail for a real procedure', async () => {
    // Discover a real numero from the list endpoint itself (resilient).
    const listRes = await get('/api/procedures?page=1&page_size=1');
    const list = (await listRes.json()) as { data: { numero_procedimiento: string }[] };
    if (list.data.length === 0) return; // empty dataset → skip
    const numero = list.data[0]!.numero_procedimiento;

    const res = await get(`/api/procedures/${encodeURIComponent(numero)}`);
    expect(res.status).toBe(200);
    const detail = (await res.json()) as {
      numero_procedimiento: string;
      institucion: { nombre: string };
      contracts: unknown[];
      expedientes: unknown[];
    };
    expect(detail.numero_procedimiento).toBe(numero);
    expect(detail.institucion.nombre).toBeTruthy();
    expect(Array.isArray(detail.contracts)).toBe(true);
    expect(Array.isArray(detail.expedientes)).toBe(true);
  });

  it('GET /api/procedures rejects an invalid sort field with 400', async () => {
    const res = await get('/api/procedures?sort=evil');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_query');
  });

  it('GET /api/analytics/summary returns totals', async () => {
    const res = await get('/api/analytics/summary');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      total_monto: number;
      total_procedimientos: number;
      total_contratos: number;
      monto_promedio: number;
      distribucion_montos: Record<string, number>;
      por_estatus: unknown[];
    };
    expect(body.total_monto).toBeGreaterThanOrEqual(0);
    expect(body.total_procedimientos).toBeGreaterThanOrEqual(0);
    expect(body.distribucion_montos).toBeDefined();
    expect(Array.isArray(body.por_estatus)).toBe(true);
  });

  it('GET /api/analytics/by-institucion?limit=5 returns ranked institutions', async () => {
    const res = await get('/api/analytics/by-institucion?limit=5');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { clave: string; nombre: string; total_monto: number }[];
    };
    expect(body.data.length).toBeLessThanOrEqual(5);
  });

  it('GET /api/analytics/by-tipo-contratacion returns both tipo dimensions', async () => {
    const res = await get('/api/analytics/by-tipo-contratacion');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      por_tipo_contratacion: unknown[];
      por_tipo_procedimiento: unknown[];
    };
    expect(Array.isArray(body.por_tipo_contratacion)).toBe(true);
    expect(Array.isArray(body.por_tipo_procedimiento)).toBe(true);
  });

  it('GET /api/analytics/top-proveedores?limit=5 returns ranked suppliers', async () => {
    const res = await get('/api/analytics/top-proveedores?limit=5');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { rfc: string; nombre: string; total_monto: number }[];
    };
    expect(body.data.length).toBeLessThanOrEqual(5);
  });

  it('unknown /api route → 404', async () => {
    const res = await get('/api/no-such-route');
    expect(res.status).toBe(404);
  });
});
