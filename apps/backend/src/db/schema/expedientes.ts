import { pgTable, serial, integer, text, index } from 'drizzle-orm/pg-core';
import { createdAt } from './_shared';
import { procedures } from './procedures';

/**
 * Expedientes (case files) belonging to a procedure.
 */
export const expedientes = pgTable(
  'expedientes',
  {
    id: serial('id').primaryKey(),
    codigoExpediente: text('codigo_expediente'),
    referencia: text('referencia'),
    titulo: text('titulo'),
    partidaEspecifica: text('partida_especifica'),
    procedureId: integer('procedure_id')
      .notNull()
      .references(() => procedures.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (table) => [index('expedientes_procedure_idx').on(table.procedureId)],
);
