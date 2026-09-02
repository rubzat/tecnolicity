import { pgTable, serial, integer, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAt } from './_shared';
import { savedSearches } from './saved-searches';
import { vigenteProcedures } from './vigente-procedures';

/**
 * Estado de "qué vigentes ya vimos para cuál búsqueda guardada" (PR13). Esta
 * tabla cumple doble función:
 *  - Evita re-notificar el mismo evento (existencia de la fila = ya se vio
 *    esta vigente para esta búsqueda; `closing_soon_notified_at` = ya se
 *    avisó el cierre próximo una vez).
 *  - Guarda el último estatus conocido para detectar cambios.
 */
export const savedSearchMatches = pgTable(
  'saved_search_matches',
  {
    id: serial('id').primaryKey(),
    savedSearchId: integer('saved_search_id')
      .notNull()
      .references(() => savedSearches.id, { onDelete: 'cascade' }),
    vigenteId: integer('vigente_id')
      .notNull()
      .references(() => vigenteProcedures.id, { onDelete: 'cascade' }),
    lastEstatus: text('last_estatus'),
    closingSoonNotifiedAt: timestamp('closing_soon_notified_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('saved_search_matches_search_vigente_idx').on(table.savedSearchId, table.vigenteId),
  ],
);
