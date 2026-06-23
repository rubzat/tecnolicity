import { pgTable, serial, integer, text, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAt } from './_shared';
import { institutions } from './institutions';

/**
 * Purchasing units (Unidades Compradoras) nested under an institution.
 * Deduplicated by natural key `clave_uc`.
 */
export const purchasingUnits = pgTable(
  'purchasing_units',
  {
    id: serial('id').primaryKey(),
    claveUc: text('clave_uc').notNull(),
    nombreUc: text('nombre_uc').notNull(),
    institutionId: integer('institution_id')
      .notNull()
      .references(() => institutions.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('purchasing_units_clave_uc_idx').on(table.claveUc),
    index('purchasing_units_institution_idx').on(table.institutionId),
  ],
);
