import { sql, type SQL } from 'drizzle-orm';
import {
  procedures,
  contracts,
  expedientes,
} from '../../db/schema/index.js';
import { segmentColumnMatches } from './segment-matcher.js';

/**
 * Shared segment condition applied at the PROCEDURE level.
 *
 * A procedure belongs to the segment when ANY keyword appears in ANY of:
 * `procedures.descripcion`, `contracts.descripcion`, `contracts.titulo`,
 * `expedientes.titulo`.
 *
 * CRITICAL for performance: emitted as a single UNION subquery
 * (`procedures.id IN (SELECT … UNION SELECT … UNION SELECT …)`), NOT an
 * `OR (… IN (…) OR … IN (…))` expression. An OR-with-subqueries forces a full
 * seq scan on procedures (the planner cannot use the tsvector GIN index through
 * the OR). The UNION lets each branch independently use its GIN index:
 * measured ~31s → ~2s for the broad 35-keyword default on 312K contracts.
 *
 * Extracted from `DrizzleMarketRepository.segmentMatchesProcedure` (PR6) so the
 * Product Intelligence module (PR10) can REUSE the exact same matcher without
 * duplicating the keyword-matching logic. `tsQuery` is bound as a SQL parameter
 * on every branch (never raw-interpolated).
 *
 * When `tsQuery` is empty the fragment short-circuits to `false` so the
 * `IN (empty set)` is still valid SQL and matches nothing.
 */
export function buildProcedureSegmentCondition(tsQuery: string): SQL {
  if (!tsQuery) {
    return sql`false`;
  }
  return sql`${procedures.id} IN (
    SELECT ${procedures.id} FROM ${procedures}
      WHERE ${segmentColumnMatches(procedures.descripcion, tsQuery)}
    UNION
    SELECT ${contracts.procedureId} FROM ${contracts}
      WHERE ${segmentColumnMatches(contracts.descripcion, tsQuery)}
         OR ${segmentColumnMatches(contracts.titulo, tsQuery)}
    UNION
    SELECT ${expedientes.procedureId} FROM ${expedientes}
      WHERE ${segmentColumnMatches(expedientes.titulo, tsQuery)}
  )`;
}
