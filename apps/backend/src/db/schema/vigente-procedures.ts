import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { createdAt } from './_shared';

/**
 * A procurement procedure that is CURRENTLY OPEN for bidding ("Anuncios
 * vigentes"), scraped live from the ComprasMX sitiopublico search API (PR7).
 *
 * Kept separate from the historical `procedures` table (which is loaded from
 * the published CSV and is almost entirely `PUBLICADO`/closed): vigente rows
 * are a different lifecycle — they expire as soon as their bid deadline passes
 * and the site rotates them out — so they deserve their own table with their
 * own freshness column (`scraped_at`).
 *
 * Natural key: `numero_procedimiento` (unique). Re-scraping upserts on it, so
 * the table always reflects the latest snapshot without duplicating.
 *
 * `uuid_procedimiento` is the SPA's internal route key: the detail URL is
 *   https://comprasmx.buengobierno.gob.mx/sitiopublico/#/sitiopublico/detalle/{uuid}/procedimiento
 * and it is also what PR4's Playwright document fetcher needs to resolve
 * anexos (see discovery #226). `direccion_anuncio` is that URL pre-built.
 *
 * `dependencia` (full institution name) is NOT present in the search response —
 * only `siglas` (e.g. "SICT", "IMSS") comes back — so it is left nullable. It
 * can be enriched later by joining `siglas` against the `institutions` table.
 */
export const vigenteProcedures = pgTable(
  'vigente_procedures',
  {
    id: serial('id').primaryKey(),
    numeroProcedimiento: text('numero_procedimiento').notNull(),
    nombre: text('nombre'),
    caracter: text('caracter'),
    /** Full institution name — not provided by the search API (nullable). */
    dependencia: text('dependencia'),
    /** Institution acronym from the API (e.g. "IMSS", "SICT"). */
    siglasDependencia: text('siglas_dependencia'),
    estatus: text('estatus'),
    /** Junta de aclaraciones (clarifications meeting) — API `fecha_aclaraciones`. */
    fechaJuntaAclaraciones: timestamp('fecha_junta_aclaraciones', { withTimezone: true }),
    /** Bid submission/opening deadline — API `fecha_apertura`. THE key date. */
    fechaPresentacionApertura: timestamp('fecha_presentacion_apertura', {
      withTimezone: true,
    }),
    tipoProcedimiento: text('tipo_procedimiento'),
    tipoContratacion: text('tipo_contratacion'),
    /** "CLAVE - NOMBRE" as returned by the API (verbatim). */
    unidadCompradora: text('unidad_compradora'),
    codigoExpediente: text('codigo_expediente'),
    /** SPA route key used to build `direccion_anuncio` and resolve anexos. */
    uuidProcedimiento: text('uuid_procedimiento'),
    /** Pre-built detail URL on ComprasMX (also PR4's fetch entry point). */
    direccionesAnuncio: text('direcciones_anuncio'),
    /** Mexican state of the contracting unit (API `entidad_federativa_contratacion`). */
    entidadFederativa: text('entidad_federativa'),
    /** When this row was last refreshed from ComprasMX. */
    scrapedAt: timestamp('scraped_at', { withTimezone: true }).defaultNow().notNull(),
    /** Full API registro, kept for forward compatibility / field discovery. */
    rawData: jsonb('raw_data'),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('vigente_procedures_numero_idx').on(table.numeroProcedimiento),
    index('vigente_procedures_siglas_idx').on(table.siglasDependencia),
    index('vigente_procedures_tipo_contratacion_idx').on(table.tipoContratacion),
    index('vigente_procedures_tipo_procedimiento_idx').on(table.tipoProcedimiento),
    index('vigente_procedures_estatus_idx').on(table.estatus),
    // Deadline-first ordering is the hot read path (most urgent first).
    index('vigente_procedures_fecha_apertura_idx').on(table.fechaPresentacionApertura),
    index('vigente_procedures_scraped_at_idx').on(table.scrapedAt),
  ],
);
