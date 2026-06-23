import type { ProcedureFilter } from '@tecnolicity/shared';
import type {
  ProcedureQueryRepository,
  AnalyticsSummary,
  InstitucionGroup,
  TipoGroup,
  SupplierGroup,
  AnalyticsParams,
} from '../../domain/repositories/procedure-query-repository.js';

/**
 * Use case: cost-analytics aggregations (CA-1 .. CA-6). Every method reuses the
 * procedure-list filter logic inside the repository, so analytics always honour
 * the same filters the user applies to the list (CA-6).
 */
export class ComputeAnalytics {
  constructor(private readonly repo: ProcedureQueryRepository) {}

  summary(filters: ProcedureFilter): Promise<AnalyticsSummary> {
    return this.repo.summary(filters);
  }

  byInstitucion(params: AnalyticsParams): Promise<InstitucionGroup[]> {
    return this.repo.byInstitucion(params);
  }

  byTipoContratacion(
    filters: ProcedureFilter,
  ): Promise<{ por_tipo_contratacion: TipoGroup[]; por_tipo_procedimiento: TipoGroup[] }> {
    return this.repo.byTipoContratacion(filters);
  }

  topProveedores(params: AnalyticsParams): Promise<SupplierGroup[]> {
    return this.repo.topProveedores(params);
  }
}
