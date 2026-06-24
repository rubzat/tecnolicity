import type {
  SupplierRepository,
  SupplierSearchPage,
  SupplierProfile,
} from '../../domain/repositories/supplier-repository.js';
import { buildSupplierSearchPredicate } from './supplier-query.js';

/**
 * Use case: Supplier Intelligence (PR9). Thin orchestration layer mirroring
 * {@link MarketIntelligence}: it normalizes the raw query (accent strip + LIKE
 * escape) here, keeping the transport layer free of matching logic, and
 * delegates to the repository. `getProfile` is a direct pass-through — the RFC
 * is a natural key (no normalization needed).
 */
export class SupplierIntelligence {
  constructor(private readonly repo: SupplierRepository) {}

  search(rawQuery: string, page: number, pageSize: number): Promise<SupplierSearchPage> {
    const needle = buildSupplierSearchPredicate(rawQuery);
    return this.repo.search(needle, page, pageSize);
  }

  getProfile(rfc: string): Promise<SupplierProfile | null> {
    return this.repo.getProfile(rfc);
  }
}
