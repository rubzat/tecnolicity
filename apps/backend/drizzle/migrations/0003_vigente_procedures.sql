-- Vigente procedures (PR7): currently-open procurement procedures scraped live
-- from the ComprasMX sitiopublico search API.
--
-- Separate from the historical `procedures` table (CSV-loaded, ~all PUBLICADO /
-- closed). Vigente rows are a different lifecycle: they roll off the site as
-- soon as their bid deadline passes, so they live in their own table with a
-- `scraped_at` freshness column and upsert by `numero_procedimiento`.
--
-- Verified API contract (discovery #231):
--   POST whitney/sitiopublico/expedientes?rows=&page=
--   body: { id_estatus:0, id_proceso:0, ... }   (0 = "Anuncios vigentes" tab)
--   resp: { success, data:[{ registros:[{numero_procedimiento, nombre_procedimiento,
--          siglas, estatus, tipo_procedimiento, cod_expediente, caracter,
--          fecha_aclaraciones, fecha_apertura, uuid_procedimiento, id_proceso,
--          entidad_federativa_contratacion, unidad_compradora, tipo_contratacion,
--          estatus_alterno}], paginacion:[{total_registros, total_paginas,...}] }] }
--
-- Idempotent (IF NOT EXISTS on every object).

CREATE TABLE IF NOT EXISTS "vigente_procedures" (
  "id" SERIAL PRIMARY KEY,
  "numero_procedimiento" TEXT NOT NULL,
  "nombre" TEXT,
  "caracter" TEXT,
  "dependencia" TEXT,
  "siglas_dependencia" TEXT,
  "estatus" TEXT,
  "fecha_junta_aclaraciones" TIMESTAMPTZ,
  "fecha_presentacion_apertura" TIMESTAMPTZ,
  "tipo_procedimiento" TEXT,
  "tipo_contratacion" TEXT,
  "unidad_compradora" TEXT,
  "codigo_expediente" TEXT,
  "uuid_procedimiento" TEXT,
  "direcciones_anuncio" TEXT,
  "entidad_federativa" TEXT,
  "scraped_at" TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  "raw_data" JSONB,
  "created_at" TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "vigente_procedures_numero_idx"
  ON "vigente_procedures" ("numero_procedimiento");

CREATE INDEX IF NOT EXISTS "vigente_procedures_siglas_idx"
  ON "vigente_procedures" ("siglas_dependencia");

CREATE INDEX IF NOT EXISTS "vigente_procedures_tipo_contratacion_idx"
  ON "vigente_procedures" ("tipo_contratacion");

CREATE INDEX IF NOT EXISTS "vigente_procedures_tipo_procedimiento_idx"
  ON "vigente_procedures" ("tipo_procedimiento");

CREATE INDEX IF NOT EXISTS "vigente_procedures_estatus_idx"
  ON "vigente_procedures" ("estatus");

-- Deadline-first ordering is the hot read path (most urgent bids first).
CREATE INDEX IF NOT EXISTS "vigente_procedures_fecha_apertura_idx"
  ON "vigente_procedures" ("fecha_presentacion_apertura");

CREATE INDEX IF NOT EXISTS "vigente_procedures_scraped_at_idx"
  ON "vigente_procedures" ("scraped_at");
