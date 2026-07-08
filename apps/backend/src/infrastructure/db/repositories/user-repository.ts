import { eq, ne, and, count, desc } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../../db/schema/index.js';
import { users } from '../../../db/schema/index.js';
import type {
  UserRepository,
  UserRecord,
  CreateUserInput,
  UpdateUserInput,
} from '../../../domain/repositories/user-repository.js';

type Db = NodePgDatabase<typeof schema>;

function toRecord(row: typeof users.$inferSelect): UserRecord {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.passwordHash,
    active: row.active,
    lastLoginAt: row.lastLoginAt,
    createdAt: row.createdAt,
  };
}

export class DrizzleUserRepository implements UserRepository {
  constructor(private readonly db: Db) {}

  async count(): Promise<number> {
    const [row] = await this.db.select({ n: count() }).from(users);
    return row?.n ?? 0;
  }

  async list(): Promise<UserRecord[]> {
    const rows = await this.db.select().from(users).orderBy(desc(users.createdAt));
    return rows.map(toRecord);
  }

  async findByUsername(username: string): Promise<UserRecord | null> {
    const [row] = await this.db.select().from(users).where(eq(users.username, username)).limit(1);
    return row ? toRecord(row) : null;
  }

  async create(input: CreateUserInput): Promise<UserRecord> {
    const [row] = await this.db
      .insert(users)
      .values({ username: input.username, passwordHash: input.passwordHash })
      .returning();
    return toRecord(row!);
  }

  async update(id: number, patch: UpdateUserInput): Promise<UserRecord | null> {
    const [row] = await this.db
      .update(users)
      .set({
        ...(patch.active !== undefined ? { active: patch.active } : {}),
        ...(patch.passwordHash !== undefined ? { passwordHash: patch.passwordHash } : {}),
      })
      .where(eq(users.id, id))
      .returning();
    return row ? toRecord(row) : null;
  }

  async delete(id: number): Promise<boolean> {
    const rows = await this.db.delete(users).where(eq(users.id, id)).returning({ id: users.id });
    return rows.length > 0;
  }

  async touchLastLogin(id: number): Promise<void> {
    await this.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, id));
  }

  async countOtherActive(excludeId: number): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(users)
      .where(and(ne(users.id, excludeId), eq(users.active, true)));
    return row?.n ?? 0;
  }
}
