import type {
  ProductRepository,
  PriceHistory,
  PriceDistribution,
  ProductSuppliers,
  ProductTopContractsPage,
  PriceGroupBy,
} from '../../domain/repositories/product-repository.js';
import { buildSegmentTsQuery } from '../market/segment-matcher.js';

/**
 * Use case: Product Price Intelligence (PR10). Thin orchestration layer
 * mirroring {@link MarketIntelligence} and {@link SupplierIntelligence}: it
 * turns a keyword list into a tsquery here (not in the router) so the
 * transport layer stays free of matching logic, then delegates to the
 * repository.
 */
export class ProductIntelligence {
  constructor(private readonly repo: ProductRepository) {}

  priceHistory(
    keywords: readonly string[],
    groupBy: PriceGroupBy,
  ): Promise<PriceHistory> {
    return this.repo.priceHistory(buildSegmentTsQuery(keywords), groupBy);
  }

  distribution(keywords: readonly string[]): Promise<PriceDistribution> {
    return this.repo.distribution(buildSegmentTsQuery(keywords));
  }

  suppliers(keywords: readonly string[], limit: number): Promise<ProductSuppliers> {
    return this.repo.suppliers(buildSegmentTsQuery(keywords), limit);
  }

  topContracts(
    keywords: readonly string[],
    page: number,
    pageSize: number,
  ): Promise<ProductTopContractsPage> {
    return this.repo.topContracts(buildSegmentTsQuery(keywords), page, pageSize);
  }
}
