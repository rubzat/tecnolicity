import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, pool } from '../../../db/client.js';
import { savedSearches, users } from '../../../db/schema/index.js';
import { DrizzleSavedSearchRepository } from './saved-search-repository.js';

const repo = new DrizzleSavedSearchRepository(db);
let testUserId: number;

beforeEach(async () => {
  await db.delete(savedSearches).where(eq(savedSearches.name, '__test_saved_search__'));
  const [user] = await db
    .insert(users)
    .values({
      username: `__test_saved_search_user_${Date.now()}_${Math.random()}`,
      passwordHash: 'x',
    })
    .returning();
  testUserId = user!.id;
});

afterAll(async () => {
  await pool.end();
});

describe('DrizzleSavedSearchRepository', () => {
  it('creates and reads back a saved search with its filters', async () => {
    const created = await repo.create({
      userId: testUserId,
      name: '__test_saved_search__',
      filters: { tipoContratacion: 'ADQUISICIONES', q: 'software' },
    });

    expect(created.id).toBeGreaterThan(0);
    expect(created.userId).toBe(testUserId);
    expect(created.active).toBe(true);
    expect(created.filters).toEqual({ tipoContratacion: 'ADQUISICIONES', q: 'software' });

    const found = await repo.findById(created.id);
    expect(found).toEqual(created);
  });

  it('listByUser only returns that user\'s searches', async () => {
    const other = await db
      .insert(users)
      .values({ username: `__test_other_${Date.now()}`, passwordHash: 'x' })
      .returning();

    await repo.create({ userId: testUserId, name: '__test_saved_search__', filters: {} });
    await repo.create({ userId: other[0]!.id, name: '__test_saved_search__', filters: {} });

    const mine = await repo.listByUser(testUserId);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.userId).toBe(testUserId);

    await db.delete(users).where(eq(users.id, other[0]!.id));
  });

  it('listActive excludes inactive searches', async () => {
    const active = await repo.create({ userId: testUserId, name: '__test_saved_search__', filters: {} });
    const inactive = await repo.create({ userId: testUserId, name: '__test_saved_search__', filters: {} });
    await repo.update(inactive.id, { active: false });

    const activeOnes = await repo.listActive();
    const ids = activeOnes.map((s) => s.id);
    expect(ids).toContain(active.id);
    expect(ids).not.toContain(inactive.id);
  });

  it('update patches name/filters/active independently', async () => {
    const created = await repo.create({ userId: testUserId, name: '__test_saved_search__', filters: { q: 'a' } });

    const renamed = await repo.update(created.id, { name: '__test_saved_search__ renamed' });
    expect(renamed?.name).toBe('__test_saved_search__ renamed');
    expect(renamed?.filters).toEqual({ q: 'a' });

    const refiltered = await repo.update(created.id, { filters: { q: 'b' } });
    expect(refiltered?.filters).toEqual({ q: 'b' });
  });

  it('delete removes the row and returns false for an unknown id', async () => {
    const created = await repo.create({ userId: testUserId, name: '__test_saved_search__', filters: {} });
    expect(await repo.delete(created.id)).toBe(true);
    expect(await repo.findById(created.id)).toBeNull();
    expect(await repo.delete(999999)).toBe(false);
  });
});
