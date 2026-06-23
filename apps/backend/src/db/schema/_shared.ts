import { timestamp } from 'drizzle-orm/pg-core';

/** Standard audit column present on every table. */
export const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).defaultNow().notNull();
