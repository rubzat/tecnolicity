import type { PaginationMeta } from '../../application/queries/pagination.js';
import type { TrendDirection } from '../../application/products/price-trend.js';

/**
 * Product Price Intelligence repository port (PR10).
 *
 * Domain contract (hexagonal port). Every method takes a pre-parsed segment
 * pattern string (the tsquery produced by `buildSegmentTsQuery`) and matches
 * it against the same text columns as the Market module — REUSING the segment
 * matcher and the existing tsvector GIN indexes (no new indexes needed).
 *
 * Amount semantics: every aggregation EXCLUDES rows with a NULL `importe_drc`
 * (a missing price contributes nothing to avg/median/min/max). Contract COUNTS
 * in price endpoints also count only priced contracts, since the user is asking
 * "what does this product COST" — unpriced rows would skew counts without
 * adding price information.
 */

/** Time granularity for the price-history endpoint. */
export type PriceGroupBy = 'year' | 'quarter' | 'month';

// --- Price history (GET /products/price-history) ---

export interface PricePeriod {
  /** Sortable string key: "2024" | "2024-Q2" | "2024-03". */
  period: string;
  /** Priced contracts in this period. */
  contracts: number;
  avg_price: number;
  min_price: number;
  max_price: number;
  /** Median importe_drc (more representative than avg — outliers don't skew it). */
  median_price: number;
  total_amount: number;
  /** Sample standard deviation (0 when fewer than 2 priced contracts). */
  stddev: number;
}

export interface PriceOverall {
  total_contracts: number;
  avg_price: number;
  median_price: number;
  min_price: number;
  max_price: number;
  total_amount: number;
}

export interface PriceHistory {
  periods: PricePeriod[];
  overall: PriceOverall;
  trend: TrendDirection;
}

// --- Distribution (GET /products/distribution) ---

export interface PriceBucket {
  /** Stable key matching PRICE_BUCKETS[].range. */
  range: string;
  /** Spanish display label. */
  label: string;
  count: number;
}

export interface PriceDistribution {
  buckets: PriceBucket[];
}

// --- Suppliers (GET /products/suppliers) ---

export interface ProductSupplier {
  nombre: string;
  rfc: string;
  contracts: number;
  avg_price: number;
  min_price: number;
  max_price: number;
  total_amount: number;
}

export interface ProductSuppliers {
  suppliers: ProductSupplier[];
}

// --- Top contracts (GET /products/top-contracts) ---

export interface ProductTopContract {
  numero_procedimiento: string;
  titulo: string | null;
  descripcion: string | null;
  importe_drc: number;
  supplier_nombre: string | null;
  supplier_rfc: string | null;
  institucion_nombre: string;
  fecha_firma: string | null;
}

export interface ProductTopContractsPage {
  data: ProductTopContract[];
  pagination: PaginationMeta;
}

/** The port. */
export interface ProductRepository {
  priceHistory(pattern: string, groupBy: PriceGroupBy): Promise<PriceHistory>;
  distribution(pattern: string): Promise<PriceDistribution>;
  suppliers(pattern: string, limit: number): Promise<ProductSuppliers>;
  topContracts(
    pattern: string,
    page: number,
    pageSize: number,
  ): Promise<ProductTopContractsPage>;
}
