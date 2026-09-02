CREATE TABLE "opportunity_segment_stats" (
	"id" serial PRIMARY KEY NOT NULL,
	"tipo_contratacion" text NOT NULL,
	"siglas_dependencia" text NOT NULL,
	"sample_size" integer NOT NULL,
	"median_amount" numeric(18, 2),
	"amount_score" integer NOT NULL,
	"distinct_suppliers" integer NOT NULL,
	"competition_score" integer NOT NULL,
	"dominant_supplier_share" numeric(5, 2),
	"is_dominated" boolean NOT NULL,
	"score" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "opportunity_segment_stats_segment_idx" ON "opportunity_segment_stats" USING btree ("tipo_contratacion","siglas_dependencia");