import type {
  MarketRepository,
  MarketOverview,
  MarketCompetitor,
  MarketBuyer,
  MarketOpportunityPage,
  MarketExpiringContract,
  MarketDominance,
} from '../../domain/repositories/market-repository.js';
import { buildSegmentTsQuery } from '../market/segment-matcher.js';

/**
 * Use case: Market Intelligence aggregations (PR6). Thin orchestration layer
 * that turns a keyword list into a regex pattern and delegates to the
 * repository. Keeping the pattern build here (not in the router) keeps the
 * transport layer free of matching logic.
 */
export class MarketIntelligence {
  constructor(private readonly repo: MarketRepository) {}

  overview(keywords: readonly string[]): Promise<MarketOverview> {
    return this.repo.overview(buildSegmentTsQuery(keywords));
  }

  competitors(keywords: readonly string[], limit: number): Promise<MarketCompetitor[]> {
    return this.repo.competitors(buildSegmentTsQuery(keywords), limit);
  }

  buyers(keywords: readonly string[], limit: number): Promise<MarketBuyer[]> {
    return this.repo.buyers(buildSegmentTsQuery(keywords), limit);
  }

  opportunities(
    keywords: readonly string[],
    page: number,
    pageSize: number,
  ): Promise<MarketOpportunityPage> {
    return this.repo.opportunities(buildSegmentTsQuery(keywords), page, pageSize);
  }

  expiring(
    keywords: readonly string[],
    months: number,
    limit: number,
  ): Promise<MarketExpiringContract[]> {
    return this.repo.expiring(buildSegmentTsQuery(keywords), months, limit);
  }

  dominance(keywords: readonly string[], limit: number): Promise<MarketDominance[]> {
    return this.repo.dominance(buildSegmentTsQuery(keywords), limit);
  }
}
