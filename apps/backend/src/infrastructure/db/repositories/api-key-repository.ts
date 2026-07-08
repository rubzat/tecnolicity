import { eq, desc } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../../db/schema/index.js';
import { apiKeys } from '../../../db/schema/index.js';
import type {
  ApiKeyRepository,
  ApiKeyRecord,
  CreateApiKeyInput,
  UpdateApiKeyInput,
} from '../../../domain/repositories/api-key-repository.js';

type Db = NodePgDatabase<typeof schema>;

function toRecord(row: typeof apiKeys.$inferSelect): ApiKeyRecord {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    keyHash: row.keyHash,
    keyPrefix: row.keyPrefix,
    rateLimitPerMinute: row.rateLimitPerMinute,
    active: row.active,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
  };
}

export class DrizzleApiKeyRepository implements ApiKeyRepository {
  constructor(private readonly db: Db) {}

  async list(): Promise<ApiKeyRecord[]> {
    const rows = await this.db.select().from(apiKeys).orderBy(desc(apiKeys.createdAt));
    return rows.map(toRecord);
  }

  async create(input: CreateApiKeyInput): Promise<ApiKeyRecord> {
    const [row] = await this.db
      .insert(apiKeys)
      .values({
        name: input.name,
        email: input.email,
        keyHash: input.keyHash,
        keyPrefix: input.keyPrefix,
        rateLimitPerMinute: input.rateLimitPerMinute,
      })
      .returning();
    return toRecord(row!);
  }

  async findByHash(keyHash: string): Promise<ApiKeyRecord | null> {
    const [row] = await this.db.select().from(apiKeys).where(eq(apiKeys.keyHash, keyHash)).limit(1);
    return row ? toRecord(row) : null;
  }

  async update(id: number, patch: UpdateApiKeyInput): Promise<ApiKeyRecord | null> {
    const [row] = await this.db
      .update(apiKeys)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.email !== undefined ? { email: patch.email } : {}),
        ...(patch.rateLimitPerMinute !== undefined
          ? { rateLimitPerMinute: patch.rateLimitPerMinute }
          : {}),
        ...(patch.active !== undefined ? { active: patch.active } : {}),
      })
      .where(eq(apiKeys.id, id))
      .returning();
    return row ? toRecord(row) : null;
  }

  async delete(id: number): Promise<boolean> {
    const rows = await this.db.delete(apiKeys).where(eq(apiKeys.id, id)).returning({ id: apiKeys.id });
    return rows.length > 0;
  }

  async touchLastUsed(id: number): Promise<void> {
    await this.db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, id));
  }
}
