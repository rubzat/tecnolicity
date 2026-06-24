-- Vigente detail cache (PR8): on-demand detail fetching for vigente procedures.
--
-- When a user opens a vigente procedure in the portal, the backend loads the
-- ComprasMX detail page via Playwright, intercepts the 3 API responses the
-- Angular SPA fires automatically (detalleProcedimiento + anexos +
-- reqeconomicos), and caches them here so repeated views are instant.
--
-- All four columns are nullable so unfetched procedures (the common case) pay no
-- storage cost and the "has detail?" check is a simple NOT NULL test.
--
-- Idempotent (ADD COLUMN IF NOT EXISTS on every statement). The base table was
-- created by migration 0003.

ALTER TABLE "vigente_procedures"
  ADD COLUMN IF NOT EXISTS "detalle_json" JSONB,
  ADD COLUMN IF NOT EXISTS "anexos_json" JSONB,
  ADD COLUMN IF NOT EXISTS "reqeconomicos_json" JSONB,
  ADD COLUMN IF NOT EXISTS "detalle_fetched_at" TIMESTAMPTZ;
