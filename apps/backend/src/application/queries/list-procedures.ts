import type { ProcedureFilter } from '@tecnolicity/shared';
import type { ProcedureQueryRepository, ProcedureListPage } from '../../domain/repositories/procedure-query-repository.js';

/**
 * Use case: list procedures with filters, pagination, sorting, and search
 * (PQ-1, PQ-2, PQ-3, PQ-7). Delegates all data access to the repository port.
 */
export class ListProcedures {
  constructor(private readonly repo: ProcedureQueryRepository) {}

  execute(
    filters: ProcedureFilter,
    page: number,
    pageSize: number,
    sort: string,
    order: 'asc' | 'desc',
  ): Promise<ProcedureListPage> {
    return this.repo.list(filters, page, pageSize, sort, order);
  }
}
