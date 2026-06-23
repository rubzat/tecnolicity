-- Market Intelligence (PR6): tsvector GIN indexes for fast keyword matching.
--
-- Performance evolution: the initial 0001 migration added pg_trgm GIN indexes,
-- which are fast for NARROW segments (~30ms single-column) but a broad
-- 35-keyword default produces a lossy trigram bitmap that rechecks nearly every
-- row (full match ~5s, API ~30s on 312K contracts).
--
-- Switching the matcher to `to_tsvector('simple', col) @@ to_tsquery(...)` with
-- a GIN index on each column brings the broad-default match to ~140ms (36x
-- faster): the tsvector GIN is an exact inverted index, no lossy recheck.
--
-- The 'simple' config lowercases but does NOT strip accents — so accented
-- variants of a keyword must be listed explicitly in market-segments.ts (they
-- are). The index expression must match the query expression EXACTLY
-- (`to_tsvector('simple', coalesce(col, ''))`) or Postgres won't use the index.
--
-- The trigram indexes from 0001 are kept: they remain useful for ad-hoc regex
-- queries and narrow single-column substring searches.
--
-- Idempotent (IF NOT EXISTS on every statement).

CREATE INDEX IF NOT EXISTS contracts_descripcion_tsv_idx
  ON contracts USING gin (to_tsvector('simple', coalesce(descripcion, '')));

CREATE INDEX IF NOT EXISTS contracts_titulo_tsv_idx
  ON contracts USING gin (to_tsvector('simple', coalesce(titulo, '')));

CREATE INDEX IF NOT EXISTS procedures_descripcion_tsv_idx
  ON procedures USING gin (to_tsvector('simple', coalesce(descripcion, '')));

CREATE INDEX IF NOT EXISTS expedientes_titulo_tsv_idx
  ON expedientes USING gin (to_tsvector('simple', coalesce(titulo, '')));
