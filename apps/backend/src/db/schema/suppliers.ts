import { pgTable, serial, text, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAt } from './_shared';

/**
 * Suppliers (proveedores / contratistas).
 * Deduplicated by natural key `rfc` (Mexican tax ID).
 */
export const suppliers = pgTable(
  'suppliers',
  {
    id: serial('id').primaryKey(),
    rfc: text('rfc').notNull(),
    nombre: text('nombre').notNull(),
    folioRupc: text('folio_rupc'),
    pais: text('pais'),
    nacionalidad: text('nacionalidad'),
    estratificacion: text('estratificacion'),
    autoRegistroCompranet: text('auto_registro_compranet'),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('suppliers_rfc_idx').on(table.rfc),
    index('suppliers_nombre_idx').on(table.nombre),
  ],
);
