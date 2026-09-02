import { pgTable, serial, integer, text, jsonb, boolean, index } from 'drizzle-orm/pg-core';
import { createdAt } from './_shared';
import { users } from './users';

/**
 * Búsquedas guardadas por usuario sobre `vigente_procedures` (PR13). Mismo
 * shape de filtros que ya acepta `GET /vigentes`, guardado como jsonb (sin
 * `.$type<>()` — el mapeo a tipos de dominio vive en el repositorio, igual
 * que `vigente_procedures.raw_data`) para no requerir una migración de
 * schema si se agrega un filtro nuevo.
 */
export const savedSearches = pgTable(
  'saved_searches',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    filters: jsonb('filters').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (table) => [index('saved_searches_user_id_idx').on(table.userId)],
);
