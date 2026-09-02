import { eq, and } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../../db/schema/index.js';
import { savedSearchMatches } from '../../../db/schema/index.js';
import type {
  SavedSearchMatchRepository,
  SavedSearchMatchRecord,
} from '../../../domain/repositories/saved-search-match-repository.js';

type Db = NodePgDatabase<typeof schema>;

function toRecord(row: typeof savedSearchMatches.$inferSelect): SavedSearchMatchRecord {
  return {
    id: row.id,
    savedSearchId: row.savedSearchId,
    vigenteId: row.vigenteId,
    lastEstatus: row.lastEstatus,
    closingSoonNotifiedAt: row.closingSoonNotifiedAt,
    createdAt: row.createdAt,
  };
}

export class DrizzleSavedSearchMatchRepository implements SavedSearchMatchRepository {
  constructor(private readonly db: Db) {}

  async findState(savedSearchId: number, vigenteId: number): Promise<SavedSearchMatchRecord | null> {
    const [row] = await this.db
      .select()
      .from(savedSearchMatches)
      .where(and(eq(savedSearchMatches.savedSearchId, savedSearchId), eq(savedSearchMatches.vigenteId, vigenteId)))
      .limit(1);
    return row ? toRecord(row) : null;
  }

  async createState(savedSearchId: number, vigenteId: number, estatus: string | null): Promise<void> {
    await this.db.insert(savedSearchMatches).values({ savedSearchId, vigenteId, lastEstatus: estatus });
  }

  async updateEstatus(savedSearchId: number, vigenteId: number, estatus: string | null): Promise<void> {
    await this.db
      .update(savedSearchMatches)
      .set({ lastEstatus: estatus })
      .where(and(eq(savedSearchMatches.savedSearchId, savedSearchId), eq(savedSearchMatches.vigenteId, vigenteId)));
  }

  async markClosingSoonNotified(savedSearchId: number, vigenteId: number): Promise<void> {
    await this.db
      .update(savedSearchMatches)
      .set({ closingSoonNotifiedAt: new Date() })
      .where(and(eq(savedSearchMatches.savedSearchId, savedSearchId), eq(savedSearchMatches.vigenteId, vigenteId)));
  }
}
