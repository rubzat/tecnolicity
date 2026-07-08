import { pgTable, serial, text, integer, boolean, timestamp, index } from 'drizzle-orm/pg-core';
import { createdAt } from './_shared';

/**
 * API keys issued by the admin to individual consumers of the public
 * read-only API (currently /api/vigentes). The public endpoint stays
 * open without a key at a low baseline rate limit; a valid, active key
 * raises that limit for its holder and is tracked to `last_used_at`.
 *
 * Only `key_hash` (SHA-256) is stored — the raw key is shown to the admin
 * exactly once, at creation, and can never be retrieved again.
 * `key_prefix` (first 8 chars of the raw key) is kept in the clear so the
 * admin panel can list keys without ever re-exposing the secret.
 */
export const apiKeys = pgTable(
  'api_keys',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email'),
    keyHash: text('key_hash').notNull().unique(),
    keyPrefix: text('key_prefix').notNull(),
    rateLimitPerMinute: integer('rate_limit_per_minute').notNull().default(300),
    active: boolean('active').notNull().default(true),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [index('api_keys_key_hash_idx').on(table.keyHash)],
);
