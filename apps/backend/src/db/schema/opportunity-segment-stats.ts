import { pgTable, serial, text, integer, numeric, boolean, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAt } from './_shared';

/**
 * Caché de estadísticas de mercado por segmento (tipo_contratación +
 * siglas_dependencia), usada para calcular el score de oportunidad de cada
 * vigente sin agregar `contracts` en cada request (PR14). Se recalcula
 * completa una vez al día (ver ComputeOpportunityScores) vía upsert por
 * segmento — nunca truncate-then-insert, así un fallo a mitad de corrida
 * deja los segmentos ya procesados en su valor más reciente.
 *
 * `siglas_dependencia` corresponde a `institutions.clave_institucion` en el
 * dataset histórico y a `vigente_procedures.siglas_dependencia` en los datos
 * en vivo — el schema de `vigente_procedures` ya documenta esta
 * correspondencia ("can be enriched later by joining siglas against the
 * institutions table").
 */
export const opportunitySegmentStats = pgTable(
  'opportunity_segment_stats',
  {
    id: serial('id').primaryKey(),
    tipoContratacion: text('tipo_contratacion').notNull(),
    siglasDependencia: text('siglas_dependencia').notNull(),
    /** # de contratos históricos que respaldan este cálculo. */
    sampleSize: integer('sample_size').notNull(),
    medianAmount: numeric('median_amount', { precision: 18, scale: 2 }),
    /** 0-100, normalizado (min-max) contra todos los segmentos de la misma corrida. */
    amountScore: integer('amount_score').notNull(),
    distinctSuppliers: integer('distinct_suppliers').notNull(),
    /** 0-100, normalizado — menos proveedores = más alto. */
    competitionScore: integer('competition_score').notNull(),
    /** % de participación del proveedor top en el segmento (para el desglose). */
    dominantSupplierShare: numeric('dominant_supplier_share', { precision: 5, scale: 2 }),
    /** true si un proveedor tiene ≥60% del segmento (mismo umbral que /market dominance). */
    isDominated: boolean('is_dominated').notNull(),
    /** Score final 0-100, ya calculado — nunca se recalcula al leer. */
    score: integer('score').notNull(),
    computedAt: createdAt(),
  },
  (table) => [
    uniqueIndex('opportunity_segment_stats_segment_idx').on(table.tipoContratacion, table.siglasDependencia),
  ],
);
