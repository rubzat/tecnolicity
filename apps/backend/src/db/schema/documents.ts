import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  pgEnum,
  index,
} from 'drizzle-orm/pg-core';
import { createdAt } from './_shared';
import { procedures } from './procedures';

/**
 * Document fetch status.
 * State machine: pending → fetched | failed | captcha_blocked
 */
export const documentEstatusEnum = pgEnum('document_estatus', [
  'pending',
  'fetched',
  'failed',
  'captcha_blocked',
]);

/**
 * Documents attached to a procedure, fetched on-demand by the Playwright worker.
 * Cache-first: once `fetched`, served from storage without re-hitting ComprasMX.
 */
export const documents = pgTable(
  'documents',
  {
    id: serial('id').primaryKey(),
    procedureId: integer('procedure_id')
      .notNull()
      .references(() => procedures.id, { onDelete: 'cascade' }),
    titulo: text('titulo'),
    tipo: text('tipo'),
    urlFuente: text('url_fuente'),
    archivoLocal: text('archivo_local'),
    /** Storage adapter reference (local path now, S3 key later). */
    storageRef: text('storage_ref'),
    fechaDescarga: timestamp('fecha_descarga', { withTimezone: true }),
    estatus: documentEstatusEnum('estatus').default('pending').notNull(),
    /** Populated on failure (e.g. reCAPTCHA block message). */
    error: text('error'),
    createdAt: createdAt(),
  },
  (table) => [
    index('documents_procedure_idx').on(table.procedureId),
    index('documents_estatus_idx').on(table.estatus),
    index('documents_procedure_estatus_idx').on(table.procedureId, table.estatus),
  ],
);
