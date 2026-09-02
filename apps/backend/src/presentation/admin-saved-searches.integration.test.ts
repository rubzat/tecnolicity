import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { eq } from 'drizzle-orm';
import { createApp } from './server.js';
import { pool, db } from '../db/client.js';
import { users } from '../db/schema/index.js';
import { hashPassword } from '../infrastructure/auth/password.js';

const app = createApp();
const server = http.createServer(app);
let baseUrl = '';
let cookieA = '';
let cookieB = '';

async function login(username: string, password: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) throw new Error(`login failed for ${username}: ${res.status}`);
  return setCookie.split(';')[0]!;
}

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });

  const passwordHash = await hashPassword('__test_password_123__');
  await db.insert(users).values([
    { username: '__test_saved_search_user_a__', passwordHash, active: true },
    { username: '__test_saved_search_user_b__', passwordHash, active: true },
  ]);
  cookieA = await login('__test_saved_search_user_a__', '__test_password_123__');
  cookieB = await login('__test_saved_search_user_b__', '__test_password_123__');
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.delete(users).where(eq(users.username, '__test_saved_search_user_a__'));
  await db.delete(users).where(eq(users.username, '__test_saved_search_user_b__'));
  await pool.end();
});

describe('admin-saved-searches (HTTP integration)', () => {
  it('crea, lista, actualiza y elimina una búsqueda guardada', async () => {
    const createRes = await fetch(`${baseUrl}/api/admin/saved-searches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieA },
      body: JSON.stringify({ name: 'Obra SICT', filters: { siglas: 'SICT', q: 'carretera' } }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: number; name: string; filters: Record<string, unknown>; active: boolean };
    expect(created.name).toBe('Obra SICT');
    expect(created.filters.siglas).toBe('SICT');
    expect(created.active).toBe(true);

    const listRes = await fetch(`${baseUrl}/api/admin/saved-searches`, { headers: { Cookie: cookieA } });
    const list = (await listRes.json()) as { data: { id: number }[] };
    expect(list.data.some((s) => s.id === created.id)).toBe(true);

    const patchRes = await fetch(`${baseUrl}/api/admin/saved-searches/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookieA },
      body: JSON.stringify({ active: false }),
    });
    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json()) as { active: boolean };
    expect(patched.active).toBe(false);

    const deleteRes = await fetch(`${baseUrl}/api/admin/saved-searches/${created.id}`, {
      method: 'DELETE',
      headers: { Cookie: cookieA },
    });
    expect(deleteRes.status).toBe(204);
  });

  it('un usuario no puede ver, editar ni eliminar las búsquedas de otro (404)', async () => {
    const createRes = await fetch(`${baseUrl}/api/admin/saved-searches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieA },
      body: JSON.stringify({ name: 'Privada de A', filters: {} }),
    });
    const created = (await createRes.json()) as { id: number };

    const listAsB = await fetch(`${baseUrl}/api/admin/saved-searches`, { headers: { Cookie: cookieB } });
    const listB = (await listAsB.json()) as { data: { id: number }[] };
    expect(listB.data.some((s) => s.id === created.id)).toBe(false);

    const patchAsB = await fetch(`${baseUrl}/api/admin/saved-searches/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookieB },
      body: JSON.stringify({ active: false }),
    });
    expect(patchAsB.status).toBe(404);

    const deleteAsB = await fetch(`${baseUrl}/api/admin/saved-searches/${created.id}`, {
      method: 'DELETE',
      headers: { Cookie: cookieB },
    });
    expect(deleteAsB.status).toBe(404);
  });

  it('rechaza requests sin sesión con 401', async () => {
    const res = await fetch(`${baseUrl}/api/admin/saved-searches`);
    expect(res.status).toBe(401);
  });

  it('valida el body con 400 cuando falta el nombre', async () => {
    const res = await fetch(`${baseUrl}/api/admin/saved-searches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieA },
      body: JSON.stringify({ filters: {} }),
    });
    expect(res.status).toBe(400);
  });
});
