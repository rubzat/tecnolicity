/**
 * Product Price Intelligence (PR10) — pure helpers.
 *
 * Two pieces of price-analysis logic that are pure functions of the
 * aggregation rows: (1) deriving a trend direction from a time series of
 * average prices, and (2) the fixed histogram bucket definitions. Kept here
 * (not in the repository) so they are trivially unit-testable without a DB.
 */

export type TrendDirection = 'increasing' | 'decreasing' | 'stable';

/**
 * Compare the first and last period's average price and classify the trend.
 *
 * A move smaller than `threshold` (default 5% of the first value) is reported
 * as `stable` — price series are noisy and a 2% drift is not a real trend.
 * Returns `stable` when there are fewer than 2 periods (nothing to compare).
 *
 * The comparison uses the FIRST vs LAST period (not a regression slope) because
 * that is what a buyer cares about: "am I paying more or less than 2 years ago?".
 */
export function computeTrend(
  avgPrices: readonly number[],
  threshold = 0.05,
): TrendDirection {
  if (avgPrices.length < 2) return 'stable';
  const first = avgPrices[0]!;
  const last = avgPrices[avgPrices.length - 1]!;
  if (first === 0) {
    return last > 0 ? 'increasing' : 'stable';
  }
  const pct = (last - first) / first;
  if (Math.abs(pct) < threshold) return 'stable';
  return pct > 0 ? 'increasing' : 'decreasing';
}

/**
 * Fixed histogram buckets for the price-distribution endpoint. Order matters:
 * the API returns them in this exact order (low → high) so the frontend can
 * render them without sorting.
 *
 * `test` is the exclusive upper bound for every bucket except the last, which
 * is open-ended (catch-all for amounts >= 100M). `range` is the stable key the
 * SQL CASE returns; `label` is the Spanish display string.
 */
export interface PriceBucketDef {
  range: string;
  label: string;
  /** Exclusive upper bound, or null for the open-ended final bucket. */
  test: number | null;
}

export const PRICE_BUCKETS: readonly PriceBucketDef[] = [
  { range: '< 10K', label: 'Menos de $10,000', test: 10_000 },
  { range: '10K-100K', label: '$10,000 - $100,000', test: 100_000 },
  { range: '100K-1M', label: '$100,000 - $1M', test: 1_000_000 },
  { range: '1M-10M', label: '$1M - $10M', test: 10_000_000 },
  { range: '10M-100M', label: '$10M - $100M', test: 100_000_000 },
  { range: '>100M', label: 'Más de $100M', test: null },
] as const;
