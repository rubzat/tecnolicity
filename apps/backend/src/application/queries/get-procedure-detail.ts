import type {
  ProcedureQueryRepository,
  ProcedureDetail,
} from '../../domain/repositories/procedure-query-repository.js';

/**
 * Use case: fetch a single procedure's full detail (PQ-4) — UC, institution,
 * expedientes, contracts (with amounts) and suppliers. Returns null when the
 * natural key is unknown so the route can answer 404 (PQ-5).
 */
export class GetProcedureDetail {
  constructor(private readonly repo: ProcedureQueryRepository) {}

  execute(numeroProcedimiento: string): Promise<ProcedureDetail | null> {
    return this.repo.getDetail(numeroProcedimiento);
  }
}
