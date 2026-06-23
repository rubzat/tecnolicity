import { pgTable, serial, text, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAt } from './_shared';

/**
 * Government institutions that publish tenders.
 * Deduplicated by natural key `clave_institucion`.
 */
export const institutions = pgTable(
  'institutions',
  {
    id: serial('id').primaryKey(),
    claveInstitucion: text('clave_institucion').notNull(),
    nombreInstitucion: text('nombre_institucion').notNull(),
    siglas: text('siglas'),
    ordenGobierno: text('orden_gobierno'),
    claveRamo: text('clave_ramo'),
    descripcionRamo: text('descripcion_ramo'),
    tipoInstitucion: text('tipo_institucion'),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('institutions_clave_institucion_idx').on(table.claveInstitucion),
    index('institutions_orden_siglas_idx').on(table.ordenGobierno, table.siglas),
  ],
);
