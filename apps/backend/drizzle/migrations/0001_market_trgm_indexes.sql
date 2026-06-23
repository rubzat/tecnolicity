-- Market Intelligence (PR6): trigram GIN indexes for fast substring keyword
-- matching across the segment text fields.
--
-- Background: the ComprasMX schema has NO "category"/"rubro" column, so market
-- segments are defined by keyword lists (software, cámara, servidor, …) matched
-- case-insensitively as SUBSTRINGS against procedure/contract/expediente text.
--
-- Naive ILIKE '%kw%' OR ... across 4 joined columns seq-scans everything
-- (~990ms for one keyword, ~2.4s for a ~20-keyword regex alternation). The OR
-- across joined tables also defeats the trigram planner, so we split the match
-- into a UNION of single-column scans — each of which uses these GIN indexes
-- (Bitmap Index Scan, ~29ms each). Full segment match + competitors
-- aggregation runs end-to-end in ~1.4s on 310K contracts.
--
-- We use pg_trgm (not tsvector) deliberately: the segment contract requires
-- TRUE substring matching ('software' must match 'desarrollo de software'),
-- which token-based tsvector/to_tsquery does not provide.
--
-- Idempotent: safe to re-run (IF NOT EXISTS on every statement).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS contracts_descripcion_trgm_idx
  ON contracts USING gin (descripcion gin_trgm_ops);

CREATE INDEX IF NOT EXISTS contracts_titulo_trgm_idx
  ON contracts USING gin (titulo gin_trgm_ops);

CREATE INDEX IF NOT EXISTS procedures_descripcion_trgm_idx
  ON procedures USING gin (descripcion gin_trgm_ops);

CREATE INDEX IF NOT EXISTS expedientes_titulo_trgm_idx
  ON expedientes USING gin (titulo gin_trgm_ops);
