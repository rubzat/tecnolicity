import { pgTable, serial, text, boolean, timestamp } from 'drizzle-orm/pg-core';
import { createdAt } from './_shared';

/**
 * Portal login accounts (PR12). Every user has the same access — there are
 * no roles — so this is closer to a shared team allowlist than a
 * permissions system. The first row is seeded at boot from
 * ADMIN_USERNAME/ADMIN_PASSWORD if the table is empty (see
 * infrastructure/auth/bootstrap-admin.ts); after that, those env vars are
 * inert and accounts are managed entirely from /admin/users.
 */
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  active: boolean('active').notNull().default(true),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: createdAt(),
});
