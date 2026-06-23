import { pgTable, serial, integer, text, boolean, date, numeric, index } from 'drizzle-orm/pg-core';
import { createdAt } from './_shared';
import { procedures } from './procedures';
import { suppliers } from './suppliers';

/**
 * Contracts awarded under a procedure, linked to a supplier.
 * Amounts are sparse (nullable) — many are null for non-consolidated rows.
 * `supplier_id` is nullable: a contract may have an unknown/unmatched supplier.
 */
export const contracts = pgTable(
  'contracts',
  {
    id: serial('id').primaryKey(),
    codigoContrato: text('codigo_contrato'),
    numeroContrato: text('numero_contrato'),
    titulo: text('titulo'),
    descripcion: text('descripcion'),
    contratoPlurianual: boolean('contrato_plurianual'),
    estatusDrc: text('estatus_drc'),
    fechaInicio: date('fecha_inicio'),
    fechaFin: date('fecha_fin'),
    fechaFirma: date('fecha_firma'),
    fechaFirmaContrato: date('fecha_firma_contrato'),
    importeDrc: numeric('importe_drc', { precision: 18, scale: 2 }),
    moneda: text('moneda').default('MXN').notNull(),
    convenioModificatorio: boolean('convenio_modificatorio'),
    codigoRefContrato: text('codigo_ref_contrato'),
    estatusContrato: text('estatus_contrato'),
    tipoContrato: text('tipo_contrato'),
    procedureId: integer('procedure_id')
      .notNull()
      .references(() => procedures.id, { onDelete: 'cascade' }),
    supplierId: integer('supplier_id').references(() => suppliers.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
  },
  (table) => [
    index('contracts_procedure_idx').on(table.procedureId),
    index('contracts_supplier_idx').on(table.supplierId),
    index('contracts_importe_drc_idx').on(table.importeDrc),
    index('contracts_estatus_drc_idx').on(table.estatusDrc),
  ],
);
