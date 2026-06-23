import { pgTable, serial, integer, text, date, numeric, pgEnum, index } from 'drizzle-orm/pg-core';
import { createdAt } from './_shared';
import { contracts } from './contracts';

/** Amount row type: original award or modified via convenio. */
export const contractAmountTipoEnum = pgEnum('contract_amount_tipo', ['original', 'convenio']);

/**
 * Min/max amount ranges for a contract (original and convenio rows).
 * Nullable because many source rows are sparse.
 */
export const contractAmounts = pgTable(
  'contract_amounts',
  {
    id: serial('id').primaryKey(),
    contractId: integer('contract_id')
      .notNull()
      .references(() => contracts.id, { onDelete: 'cascade' }),
    montoSinImpMin: numeric('monto_sin_imp_min', { precision: 18, scale: 2 }),
    montoConImpMin: numeric('monto_con_imp_min', { precision: 18, scale: 2 }),
    montoSinImpMax: numeric('monto_sin_imp_max', { precision: 18, scale: 2 }),
    montoConImpMax: numeric('monto_con_imp_max', { precision: 18, scale: 2 }),
    moneda: text('moneda').default('MXN').notNull(),
    tipo: contractAmountTipoEnum('tipo').default('original').notNull(),
    codigoRef: text('codigo_ref'),
    fechaFinConvenio: date('fecha_fin_convenio'),
    createdAt: createdAt(),
  },
  (table) => [
    index('contract_amounts_contract_idx').on(table.contractId),
    index('contract_amounts_monto_con_imp_max_idx').on(table.montoConImpMax),
  ],
);
