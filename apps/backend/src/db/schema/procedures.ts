import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  vector,
} from 'drizzle-orm/pg-core';
import { createdAt } from './_shared';
import { purchasingUnits } from './purchasing-units';

/** Embedding dimension (OpenAI ada-002 = 1536). Env-overridable to avoid provider lock-in. */
const EMBEDDING_DIM = Number(process.env.EMBEDDING_DIM ?? 1536);

/**
 * A public procurement procedure (licitación).
 * Natural business key: `numero_procedimiento` (unique).
 * `embedding` is created now but populated in a later semantic-search phase.
 */
export const procedures = pgTable(
  'procedures',
  {
    id: serial('id').primaryKey(),
    numeroProcedimiento: text('numero_procedimiento').notNull(),
    caracter: text('caracter'),
    tipoContratacion: text('tipo_contratacion'),
    tipoProcedimiento: text('tipo_procedimiento'),
    ley: text('ley'),
    articuloExcepcion: text('articulo_excepcion'),
    descripcionExcepcion: text('descripcion_excepcion'),
    contratoMarco: boolean('contrato_marco'),
    compraConsolidada: boolean('compra_consolidada'),
    formaParticipacion: text('forma_participacion'),
    casoFortuito: text('caso_fortuito'),
    creditoExterno: boolean('credito_externo'),
    /** Procedure status (Adjudicado, En etapa de fallo, etc.) — free text from CSV. */
    estatus: text('estatus'),
    fechaPublicacion: timestamp('fecha_publicacion', { withTimezone: true }),
    fechaApertura: timestamp('fecha_apertura', { withTimezone: true }),
    fechaFallo: timestamp('fecha_fallo', { withTimezone: true }),
    /** Playwright entry URL for document fetching (Dirección del anuncio). */
    direccionAnuncio: text('direccion_anuncio'),
    descripcion: text('descripcion'),
    /** Batch identifier from the ingestion pipeline. */
    ingestionBatchId: text('ingestion_batch_id'),
    purchasingUnitId: integer('purchasing_unit_id')
      .notNull()
      .references(() => purchasingUnits.id, { onDelete: 'restrict' }),
    /** Nullable until populated in a later phase; ivfflat-indexed for ANN search. */
    embedding: vector('embedding', { dimensions: EMBEDDING_DIM }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('procedures_numero_procedimiento_idx').on(table.numeroProcedimiento),
    index('procedures_purchasing_unit_idx').on(table.purchasingUnitId),
    index('procedures_tipo_contratacion_idx').on(table.tipoContratacion),
    index('procedures_tipo_procedimiento_idx').on(table.tipoProcedimiento),
    index('procedures_ley_idx').on(table.ley),
    index('procedures_estatus_idx').on(table.estatus),
    index('procedures_fecha_publicacion_idx').on(table.fechaPublicacion),
    index('procedures_fecha_apertura_idx').on(table.fechaApertura),
    index('procedures_fecha_fallo_idx').on(table.fechaFallo),
  ],
);
