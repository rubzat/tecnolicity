import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../../db/schema/index.js';
import { savedSearches } from '../../../db/schema/index.js';
import type {
  SavedSearchRepository,
  SavedSearchRecord,
  SavedSearchFilters,
  CreateSavedSearchInput,
  UpdateSavedSearchInput,
} from '../../../domain/repositories/saved-search-repository.js';

type Db = NodePgDatabase<typeof schema>;

function toRecord(row: typeof savedSearches.$inferSelect): SavedSearchRecord {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    filters: row.filters as SavedSearchFilters,
    active: row.active,
    createdAt: row.createdAt,
  };
}

export class DrizzleSavedSearchRepository implements SavedSearchRepository {
  constructor(private readonly db: Db) {}

  async listByUser(userId: number): Promise<SavedSearchRecord[]> {
    const rows = await this.db.select().from(savedSearches).where(eq(savedSearches.userId, userId));
    return rows.map(toRecord);
  }

  async listActive(): Promise<SavedSearchRecord[]> {
    const rows = await this.db.select().from(savedSearches).where(eq(savedSearches.active, true));
    return rows.map(toRecord);
  }

  async findById(id: number): Promise<SavedSearchRecord | null> {
    const [row] = await this.db.select().from(savedSearches).where(eq(savedSearches.id, id)).limit(1);
    return row ? toRecord(row) : null;
  }

  async create(input: CreateSavedSearchInput): Promise<SavedSearchRecord> {
    const [row] = await this.db
      .insert(savedSearches)
      .values({ userId: input.userId, name: input.name, filters: input.filters })
      .returning();
    return toRecord(row!);
  }

  async update(id: number, patch: UpdateSavedSearchInput): Promise<SavedSearchRecord | null> {
    const [row] = await this.db
      .update(savedSearches)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.filters !== undefined ? { filters: patch.filters } : {}),
        ...(patch.active !== undefined ? { active: patch.active } : {}),
      })
      .where(eq(savedSearches.id, id))
      .returning();
    return row ? toRecord(row) : null;
  }

  async delete(id: number): Promise<boolean> {
    const rows = await this.db.delete(savedSearches).where(eq(savedSearches.id, id)).returning({ id: savedSearches.id });
    return rows.length > 0;
  }
}
