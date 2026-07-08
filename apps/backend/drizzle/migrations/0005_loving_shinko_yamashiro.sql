-- api_keys (public API key issuance for /api/vigentes and friends).
--
-- NOTE: drizzle-kit's snapshot chain is missing meta/0001..0004_snapshot.json
-- (those four migrations were hand-authored directly as idempotent SQL,
-- bypassing `drizzle-kit generate`), so `generate` diffed against the stale
-- 0000 snapshot and tried to re-emit every table since — including
-- `vigente_procedures`, which already exists. That block was stripped by
-- hand; only the genuinely new `api_keys` table remains below. The
-- accompanying 0005_snapshot.json is unaffected and correctly represents
-- the full current schema, so future `generate` runs diff from here forward
-- without repeating this.
CREATE TABLE "api_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"rate_limit_per_minute" integer DEFAULT 300 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE INDEX "api_keys_key_hash_idx" ON "api_keys" USING btree ("key_hash");