import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from './server.js';
import { pool } from '../db/client.js';

/**
 * HTTP integration tests for the document endpoints.
 *
 * Only exercises SAFE paths (GET cache reads + 404s). The POST /fetch against a
 * real procedure launches Playwright against ComprasMX (slow, external,
 * reCAPTCHA-gated) and is verified manually in the live step, NOT here.
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
async function post(path: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { method: 'POST' });
}

describe('Documents API (HTTP integration)', () => {
  it('GET /documents for a real procedure → 200 with a data array', async () => {
    // Discover a real numero from the list endpoint (resilient to dataset state).
    const listRes = await get('/api/procedures?page=1&page_size=1');
    const list = (await listRes.json()) as { data: { numero_procedimiento: string }[] };
    if (list.data.length === 0) return; // empty dataset → skip

    const numero = list.data[0]!.numero_procedimiento;
    const res = await get(`/api/procedures/${encodeURIComponent(numero)}/documents`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('GET /documents for an unknown procedure → 404', async () => {
    const res = await get('/api/procedures/NO-SUCH-PROCEDURE-999/documents');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('not_found');
  });

  it('POST /documents/fetch for an unknown procedure → 404', async () => {
    const res = await post('/api/procedures/NO-SUCH-PROCEDURE-999/documents/fetch');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('not_found');
  });

  it('GET /documents/:id/download for an unknown procedure → 404', async () => {
    const res = await get('/api/procedures/NO-SUCH-PROCEDURE-999/documents/1/download');
    expect(res.status).toBe(404);
  });

  it('GET /documents/:id/download rejects a non-numeric id with 400', async () => {
    const res = await get('/api/procedures/whatever/documents/abc/download');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_document_id');
  });
});
