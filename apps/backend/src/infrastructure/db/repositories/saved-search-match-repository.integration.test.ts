import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, pool } from '../../../db/client.js';
import { savedSearches, users, vigenteProcedures } from '../../../db/schema/index.js';
import { DrizzleSavedSearchMatchRepository } from './saved-search-match-repository.js';

const repo = new DrizzleSavedSearchMatchRepository(db);
let searchId: number;
let vigenteId: number;

beforeEach(async () => {
  const [user] = await db
    .insert(users)
    .values({ username: `__test_match_user_${Date.now()}_${Math.random()}`, passwordHash: 'x' })
    .returning();
  const [search] = await db
    .insert(savedSearches)
    .values({ userId: user!.id, name: '__test__', filters: {} })
    .returning();
  searchId = search!.id;

  const numero = `__TEST-MATCH-${Date.now()}-${Math.random()}`;
  const [vigente] = await db
    .insert(vigenteProcedures)
    .values({ numeroProcedimiento: numero, estatus: 'PUBLICADA' })
    .returning();
  vigenteId = vigente!.id;
});

afterAll(async () => {
  await pool.end();
});

describe('DrizzleSavedSearchMatchRepository', () => {
  it('findState returns null when the pair was never seen', async () => {
    expect(await repo.findState(searchId, vigenteId)).toBeNull();
  });

  it('createState then findState returns the baseline row', async () => {
    await repo.createState(searchId, vigenteId, 'PUBLICADA');
    const state = await repo.findState(searchId, vigenteId);
    expect(state).not.toBeNull();
    expect(state!.savedSearchId).toBe(searchId);
    expect(state!.vigenteId).toBe(vigenteId);
    expect(state!.lastEstatus).toBe('PUBLICADA');
    expect(state!.closingSoonNotifiedAt).toBeNull();
  });

  it('updateEstatus changes last_estatus without touching closing_soon_notified_at', async () => {
    await repo.createState(searchId, vigenteId, 'PUBLICADA');
    await repo.markClosingSoonNotified(searchId, vigenteId);
    await repo.updateEstatus(searchId, vigenteId, 'EN EVALUACIÓN');

    const state = await repo.findState(searchId, vigenteId);
    expect(state!.lastEstatus).toBe('EN EVALUACIÓN');
    expect(state!.closingSoonNotifiedAt).not.toBeNull();
  });

  it('markClosingSoonNotified sets a timestamp', async () => {
    await repo.createState(searchId, vigenteId, 'PUBLICADA');
    await repo.markClosingSoonNotified(searchId, vigenteId);
    const state = await repo.findState(searchId, vigenteId);
    expect(state!.closingSoonNotifiedAt).toBeInstanceOf(Date);
  });
});
