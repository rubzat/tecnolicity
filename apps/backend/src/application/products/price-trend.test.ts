import { describe, it, expect } from 'vitest';
import { computeTrend, PRICE_BUCKETS } from './price-trend.js';

describe('computeTrend', () => {
  it('returns stable when there are fewer than 2 periods', () => {
    expect(computeTrend([])).toBe('stable');
    expect(computeTrend([100])).toBe('stable');
  });

  it('returns stable when the move is below the threshold', () => {
    // 3% drift < 5% default threshold → stable.
    expect(computeTrend([1_000_000, 1_030_000])).toBe('stable');
    expect(computeTrend([1_000_000, 970_000])).toBe('stable');
  });

  it('classifies a real increase as increasing', () => {
    expect(computeTrend([1_000_000, 1_200_000])).toBe('increasing');
    // Across many periods — only first vs last matters.
    expect(computeTrend([500_000, 1_000_000, 800_000, 1_500_000])).toBe(
      'increasing',
    );
  });

  it('classifies a real decrease as decreasing', () => {
    expect(computeTrend([1_000_000, 600_000])).toBe('decreasing');
    expect(computeTrend([1_500_000, 1_000_000, 800_000, 500_000])).toBe(
      'decreasing',
    );
  });

  it('honours a custom threshold', () => {
    // With a 1% threshold, a 3% drift is now a real trend.
    expect(computeTrend([1_000_000, 1_030_000], 0.01)).toBe('increasing');
  });

  it('handles a zero first value without dividing by zero', () => {
    expect(computeTrend([0, 0])).toBe('stable');
    expect(computeTrend([0, 100])).toBe('increasing');
    expect(computeTrend([0, 0, 0])).toBe('stable');
  });

  it('tolerates a zero last value as a real decrease', () => {
    expect(computeTrend([100, 0])).toBe('decreasing');
  });
});

describe('PRICE_BUCKETS', () => {
  it('defines 6 buckets in ascending order with exclusive upper bounds', () => {
    expect(PRICE_BUCKETS).toHaveLength(6);
    const bounds = PRICE_BUCKETS.map((b) => b.test);
    // Every bound except the last (null) is a positive ascending number.
    for (let i = 0; i < bounds.length - 1; i++) {
      expect(bounds[i]).toBeGreaterThan(0);
      expect(bounds[i]!).toBeLessThan(bounds[i + 1] ?? Number.POSITIVE_INFINITY);
    }
    // Last bucket is the open-ended catch-all.
    expect(bounds[bounds.length - 1]).toBeNull();
  });

  it('every bucket has a stable range key and a Spanish label', () => {
    for (const b of PRICE_BUCKETS) {
      expect(b.range.length).toBeGreaterThan(0);
      expect(b.label.length).toBeGreaterThan(0);
    }
    // Spot-check the boundaries (the SQL CASE in the repo mirrors these).
    expect(PRICE_BUCKETS[0]!.test).toBe(10_000);
    expect(PRICE_BUCKETS[1]!.test).toBe(100_000);
    expect(PRICE_BUCKETS[2]!.test).toBe(1_000_000);
    expect(PRICE_BUCKETS[3]!.test).toBe(10_000_000);
    expect(PRICE_BUCKETS[4]!.test).toBe(100_000_000);
  });
});
