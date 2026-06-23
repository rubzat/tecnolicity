-- Enable pgvector extension (must precede the procedures.embedding vector column)
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TYPE "public"."contract_amount_tipo" AS ENUM('original', 'convenio');--> statement-breakpoint
CREATE TYPE "public"."document_estatus" AS ENUM('pending', 'fetched', 'failed', 'captcha_blocked');--> statement-breakpoint
CREATE TABLE "contract_amounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"contract_id" integer NOT NULL,
	"monto_sin_imp_min" numeric(18, 2),
	"monto_con_imp_min" numeric(18, 2),
	"monto_sin_imp_max" numeric(18, 2),
	"monto_con_imp_max" numeric(18, 2),
	"moneda" text DEFAULT 'MXN' NOT NULL,
	"tipo" "contract_amount_tipo" DEFAULT 'original' NOT NULL,
	"codigo_ref" text,
	"fecha_fin_convenio" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" serial PRIMARY KEY NOT NULL,
	"codigo_contrato" text,
	"numero_contrato" text,
	"titulo" text,
	"descripcion" text,
	"contrato_plurianual" boolean,
	"estatus_drc" text,
	"fecha_inicio" date,
	"fecha_fin" date,
	"fecha_firma" date,
	"fecha_firma_contrato" date,
	"importe_drc" numeric(18, 2),
	"moneda" text DEFAULT 'MXN' NOT NULL,
	"convenio_modificatorio" boolean,
	"codigo_ref_contrato" text,
	"estatus_contrato" text,
	"tipo_contrato" text,
	"procedure_id" integer NOT NULL,
	"supplier_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"procedure_id" integer NOT NULL,
	"titulo" text,
	"tipo" text,
	"url_fuente" text,
	"archivo_local" text,
	"storage_ref" text,
	"fecha_descarga" timestamp with time zone,
	"estatus" "document_estatus" DEFAULT 'pending' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expedientes" (
	"id" serial PRIMARY KEY NOT NULL,
	"codigo_expediente" text,
	"referencia" text,
	"titulo" text,
	"partida_especifica" text,
	"procedure_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "institutions" (
	"id" serial PRIMARY KEY NOT NULL,
	"clave_institucion" text NOT NULL,
	"nombre_institucion" text NOT NULL,
	"siglas" text,
	"orden_gobierno" text,
	"clave_ramo" text,
	"descripcion_ramo" text,
	"tipo_institucion" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "procedures" (
	"id" serial PRIMARY KEY NOT NULL,
	"numero_procedimiento" text NOT NULL,
	"caracter" text,
	"tipo_contratacion" text,
	"tipo_procedimiento" text,
	"ley" text,
	"articulo_excepcion" text,
	"descripcion_excepcion" text,
	"contrato_marco" boolean,
	"compra_consolidada" boolean,
	"forma_participacion" text,
	"caso_fortuito" text,
	"credito_externo" boolean,
	"estatus" text,
	"fecha_publicacion" timestamp with time zone,
	"fecha_apertura" timestamp with time zone,
	"fecha_fallo" timestamp with time zone,
	"direccion_anuncio" text,
	"descripcion" text,
	"ingestion_batch_id" text,
	"purchasing_unit_id" integer NOT NULL,
	"embedding" vector(1536),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchasing_units" (
	"id" serial PRIMARY KEY NOT NULL,
	"clave_uc" text NOT NULL,
	"nombre_uc" text NOT NULL,
	"institution_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" serial PRIMARY KEY NOT NULL,
	"rfc" text NOT NULL,
	"nombre" text NOT NULL,
	"folio_rupc" text,
	"pais" text,
	"nacionalidad" text,
	"estratificacion" text,
	"auto_registro_compranet" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contract_amounts" ADD CONSTRAINT "contract_amounts_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_procedure_id_procedures_id_fk" FOREIGN KEY ("procedure_id") REFERENCES "public"."procedures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_procedure_id_procedures_id_fk" FOREIGN KEY ("procedure_id") REFERENCES "public"."procedures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expedientes" ADD CONSTRAINT "expedientes_procedure_id_procedures_id_fk" FOREIGN KEY ("procedure_id") REFERENCES "public"."procedures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedures" ADD CONSTRAINT "procedures_purchasing_unit_id_purchasing_units_id_fk" FOREIGN KEY ("purchasing_unit_id") REFERENCES "public"."purchasing_units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchasing_units" ADD CONSTRAINT "purchasing_units_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contract_amounts_contract_idx" ON "contract_amounts" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "contract_amounts_monto_con_imp_max_idx" ON "contract_amounts" USING btree ("monto_con_imp_max");--> statement-breakpoint
CREATE INDEX "contracts_procedure_idx" ON "contracts" USING btree ("procedure_id");--> statement-breakpoint
CREATE INDEX "contracts_supplier_idx" ON "contracts" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "contracts_importe_drc_idx" ON "contracts" USING btree ("importe_drc");--> statement-breakpoint
CREATE INDEX "contracts_estatus_drc_idx" ON "contracts" USING btree ("estatus_drc");--> statement-breakpoint
CREATE INDEX "documents_procedure_idx" ON "documents" USING btree ("procedure_id");--> statement-breakpoint
CREATE INDEX "documents_estatus_idx" ON "documents" USING btree ("estatus");--> statement-breakpoint
CREATE INDEX "documents_procedure_estatus_idx" ON "documents" USING btree ("procedure_id","estatus");--> statement-breakpoint
CREATE INDEX "expedientes_procedure_idx" ON "expedientes" USING btree ("procedure_id");--> statement-breakpoint
CREATE UNIQUE INDEX "institutions_clave_institucion_idx" ON "institutions" USING btree ("clave_institucion");--> statement-breakpoint
CREATE INDEX "institutions_orden_siglas_idx" ON "institutions" USING btree ("orden_gobierno","siglas");--> statement-breakpoint
CREATE UNIQUE INDEX "procedures_numero_procedimiento_idx" ON "procedures" USING btree ("numero_procedimiento");--> statement-breakpoint
CREATE INDEX "procedures_purchasing_unit_idx" ON "procedures" USING btree ("purchasing_unit_id");--> statement-breakpoint
CREATE INDEX "procedures_tipo_contratacion_idx" ON "procedures" USING btree ("tipo_contratacion");--> statement-breakpoint
CREATE INDEX "procedures_tipo_procedimiento_idx" ON "procedures" USING btree ("tipo_procedimiento");--> statement-breakpoint
CREATE INDEX "procedures_ley_idx" ON "procedures" USING btree ("ley");--> statement-breakpoint
CREATE INDEX "procedures_estatus_idx" ON "procedures" USING btree ("estatus");--> statement-breakpoint
CREATE INDEX "procedures_fecha_publicacion_idx" ON "procedures" USING btree ("fecha_publicacion");--> statement-breakpoint
CREATE INDEX "procedures_fecha_apertura_idx" ON "procedures" USING btree ("fecha_apertura");--> statement-breakpoint
CREATE INDEX "procedures_fecha_fallo_idx" ON "procedures" USING btree ("fecha_fallo");--> statement-breakpoint
CREATE UNIQUE INDEX "purchasing_units_clave_uc_idx" ON "purchasing_units" USING btree ("clave_uc");--> statement-breakpoint
CREATE INDEX "purchasing_units_institution_idx" ON "purchasing_units" USING btree ("institution_id");--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_rfc_idx" ON "suppliers" USING btree ("rfc");--> statement-breakpoint
CREATE INDEX "suppliers_nombre_idx" ON "suppliers" USING btree ("nombre");--> statement-breakpoint
-- ivfflat ANN index for cosine similarity search over procedure embeddings.
-- NOTE: built on an empty column for now; rebuild (DROP + CREATE) after embedding
-- population so the lists reflect actual data distribution.
CREATE INDEX "procedures_embedding_ivfflat_idx" ON "procedures" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);