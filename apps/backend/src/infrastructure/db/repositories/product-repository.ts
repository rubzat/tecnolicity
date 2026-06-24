import { and, eq, desc, asc, sql, count, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../../db/schema/index.js';
import {
  contracts,
  procedures,
  purchasingUnits,
  institutions,
  suppliers,
} from '../../../db/schema/index.js';
import { buildProcedureSegmentCondition } from '../../../application/market/procedure-segment.js';
import { computePagination } from '../../../application/queries/pagination.js';
import {
  computeTrend,
  PRICE_BUCKETS,
} from '../../../application/products/price-trend.js';
import type {
  ProductRepository,
  PriceHistory,
  PricePeriod,
  PriceOverall,
  PriceDistribution,
  PriceBucket,
  ProductSuppliers,
  ProductSupplier,
  ProductTopContractsPage,
  ProductTopContract,
  PriceGroupBy,
} from '../../../domain/repositories/product-repository.js';

type Db = NodePgDatabase<typeof schema>;

/**
 * Drizzle read-side implementation of {@link ProductRepository} (PR10).
 *
 * REUSES the Market module's segment matcher (`buildProcedureSegmentCondition`)
 * and the existing tsvector GIN indexes — no new indexes are created. Every
 * query scopes to a keyword segment at the PROCEDURE level, then joins down to
 * contracts/suppliers/institutions exactly like the market repository.
 *
 * Price semantics: every aggregation EXCLUDES contracts with a NULL
 * `importe_drc` (added explicitly as `${contracts.importeDrc} IS NOT NULL`).
 * The date used for time grouping is
 * `coalesce(fecha_firma, fecha_inicio, fecha_publicacion::date)` so a contract
 * missing its signing date still lands in a period.
 *
 * median via `percentile_cont(0.5)` over a double-precision cast (the
 * ordered-set agg skips NULLs automatically — correct since we already filter
 * NULLs). stddev via `stddev_samp` (sample), coalesced to 0.
 */
export class DrizzleProductRepository implements ProductRepository {
  constructor(private readonly db: Db) {}

  // ──────────────────────────────────────────────────────────── price history ──

  async priceHistory(pattern: string, groupBy: PriceGroupBy): Promise<PriceHistory> {
    const segCond = buildProcedureSegmentCondition(pattern);
    const priced = sql`${contracts.importeDrc} IS NOT NULL` as SQL;

    // Date for time grouping: prefer the contract's signing date, fall back to
    // its start date, then to the procedure's publication date (cast to date).
    const dateExpr = sql<Date>`coalesce(${contracts.fechaFirma}, ${contracts.fechaInicio}, ${procedures.fechaPublicacion}::date)`;

    // Period key: sortable lexicographically (year zero-padded by EXTRACT/int;
    // month via to_char 'YYYY-MM'; quarter as 'YYYY-Qn' with n in 1..4).
    const periodExpr =
      groupBy === 'year'
        ? (sql<string>`extract(year from ${dateExpr})::int::text`)
        : groupBy === 'quarter'
          ? (sql<string>`extract(year from ${dateExpr})::int::text || '-Q' || extract(quarter from ${dateExpr})::int::text`)
          : (sql<string>`to_char(${dateExpr}, 'YYYY-MM')`);

    const baseQuery = this.db
      .select({
        period: periodExpr.as('period'),
        contracts: count(),
        avg_price: sql<string>`coalesce(avg(${contracts.importeDrc}), 0)`,
        min_price: sql<string>`coalesce(min(${contracts.importeDrc}), 0)`,
        max_price: sql<string>`coalesce(max(${contracts.importeDrc}), 0)`,
        median_price: sql<string>`coalesce(percentile_cont(0.5) WITHIN GROUP (ORDER BY ${contracts.importeDrc}::double precision), 0)`,
        total_amount: sql<string>`coalesce(sum(${contracts.importeDrc}), 0)`,
        stddev: sql<string>`coalesce(stddev_samp(${contracts.importeDrc}::double precision), 0)`,
        // min(date) only for chronological ORDER BY (period string also sorts,
        // but min(date) is unambiguous across granularities).
        period_start: sql<Date>`min(${dateExpr})`.as('period_start'),
      })
      .from(contracts)
      .innerJoin(procedures, eq(procedures.id, contracts.procedureId))
      .innerJoin(
        purchasingUnits,
        eq(purchasingUnits.id, procedures.purchasingUnitId),
      )
      .innerJoin(institutions, eq(institutions.id, purchasingUnits.institutionId))
      .where(and(segCond, priced, sql`${dateExpr} IS NOT NULL`));

    const [periodRows, overallRows] = await Promise.all([
      baseQuery.groupBy(periodExpr).orderBy(asc(sql`period_start`)),
      this.db
        .select({
          total_contracts: count(),
          avg_price: sql<string>`coalesce(avg(${contracts.importeDrc}), 0)`,
          min_price: sql<string>`coalesce(min(${contracts.importeDrc}), 0)`,
          max_price: sql<string>`coalesce(max(${contracts.importeDrc}), 0)`,
          median_price: sql<string>`coalesce(percentile_cont(0.5) WITHIN GROUP (ORDER BY ${contracts.importeDrc}::double precision), 0)`,
          total_amount: sql<string>`coalesce(sum(${contracts.importeDrc}), 0)`,
        })
        .from(contracts)
        .innerJoin(procedures, eq(procedures.id, contracts.procedureId))
        .innerJoin(
          purchasingUnits,
          eq(purchasingUnits.id, procedures.purchasingUnitId),
        )
        .innerJoin(
          institutions,
          eq(institutions.id, purchasingUnits.institutionId),
        )
        .where(and(segCond, priced)),
    ]);

    const periods: PricePeriod[] = periodRows.map((r) => ({
      period: String(r.period),
      contracts: Number(r.contracts ?? 0),
      avg_price: toNum(r.avg_price),
      min_price: toNum(r.min_price),
      max_price: toNum(r.max_price),
      median_price: toNum(r.median_price),
      total_amount: toNum(r.total_amount),
      stddev: toNum(r.stddev),
    }));

    const o = overallRows[0];
    const overall: PriceOverall = {
      total_contracts: Number(o?.total_contracts ?? 0),
      avg_price: toNum(o?.avg_price),
      min_price: toNum(o?.min_price),
      max_price: toNum(o?.max_price),
      median_price: toNum(o?.median_price),
      total_amount: toNum(o?.total_amount),
    };

    return {
      periods,
      overall,
      trend: computeTrend(periods.map((p) => p.avg_price)),
    };
  }

  // ──────────────────────────────────────────────────────────── distribution ──

  async distribution(pattern: string): Promise<PriceDistribution> {
    const segCond = buildProcedureSegmentCondition(pattern);

    // Bucket key via CASE — bounds mirror PRICE_BUCKETS exactly. The last arm
    // (ELSE) catches everything >= 100M (the open-ended final bucket).
    const bucketExpr = sql<string>`
      CASE
        WHEN ${contracts.importeDrc} < 10000 THEN '< 10K'
        WHEN ${contracts.importeDrc} < 100000 THEN '10K-100K'
        WHEN ${contracts.importeDrc} < 1000000 THEN '100K-1M'
        WHEN ${contracts.importeDrc} < 10000000 THEN '1M-10M'
        WHEN ${contracts.importeDrc} < 100000000 THEN '10M-100M'
        ELSE '>100M'
      END
    `.as('bucket_range');

    const rows = await this.db
      .select({ range: bucketExpr, count: count() })
      .from(contracts)
      .innerJoin(procedures, eq(procedures.id, contracts.procedureId))
      .innerJoin(
        purchasingUnits,
        eq(purchasingUnits.id, procedures.purchasingUnitId),
      )
      .innerJoin(institutions, eq(institutions.id, purchasingUnits.institutionId))
      .where(and(segCond, sql`${contracts.importeDrc} IS NOT NULL`))
      .groupBy(bucketExpr);

    // Merge with the template so all 6 buckets always appear (count 0 when no
    // contracts landed in that bucket), in the canonical ascending order.
    const byRange = new Map(rows.map((r) => [String(r.range), Number(r.count ?? 0)]));
    const buckets: PriceBucket[] = PRICE_BUCKETS.map((b) => ({
      range: b.range,
      label: b.label,
      count: byRange.get(b.range) ?? 0,
    }));

    return { buckets };
  }

  // ────────────────────────────────────────────────────────────── suppliers ──

  async suppliers(pattern: string, limit: number): Promise<ProductSuppliers> {
    const segCond = buildProcedureSegmentCondition(pattern);

    // INNER JOIN suppliers: only contracts with a named supplier. Aggregated
    // per supplier so the user can see WHO sells this product and at WHAT price.
    const rows = await this.db
      .select({
        nombre: suppliers.nombre,
        rfc: suppliers.rfc,
        contracts: count(),
        avg_price: sql<string>`coalesce(avg(${contracts.importeDrc}), 0)`,
        min_price: sql<string>`coalesce(min(${contracts.importeDrc}), 0)`,
        max_price: sql<string>`coalesce(max(${contracts.importeDrc}), 0)`,
        total_amount: sql<string>`coalesce(sum(${contracts.importeDrc}), 0)`.as(
          'total_amount',
        ),
      })
      .from(contracts)
      .innerJoin(procedures, eq(procedures.id, contracts.procedureId))
      .innerJoin(
        purchasingUnits,
        eq(purchasingUnits.id, procedures.purchasingUnitId),
      )
      .innerJoin(institutions, eq(institutions.id, purchasingUnits.institutionId))
      .innerJoin(suppliers, eq(suppliers.id, contracts.supplierId))
      .where(and(segCond, sql`${contracts.importeDrc} IS NOT NULL`))
      .groupBy(suppliers.id, suppliers.rfc, suppliers.nombre)
      .orderBy(desc(sql`total_amount`))
      .limit(limit);

    const list: ProductSupplier[] = rows.map((r) => ({
      nombre: r.nombre,
      rfc: r.rfc,
      contracts: Number(r.contracts ?? 0),
      avg_price: toNum(r.avg_price),
      min_price: toNum(r.min_price),
      max_price: toNum(r.max_price),
      total_amount: toNum(r.total_amount),
    }));

    return { suppliers: list };
  }

  // ─────────────────────────────────────────────────────────── top contracts ──

  async topContracts(
    pattern: string,
    page: number,
    pageSize: number,
  ): Promise<ProductTopContractsPage> {
    const segCond = buildProcedureSegmentCondition(pattern);
    const priced = sql`${contracts.importeDrc} IS NOT NULL` as SQL;

    const countRow = await this.db
      .select({ total: count() })
      .from(contracts)
      .innerJoin(procedures, eq(procedures.id, contracts.procedureId))
      .innerJoin(
        purchasingUnits,
        eq(purchasingUnits.id, procedures.purchasingUnitId),
      )
      .innerJoin(institutions, eq(institutions.id, purchasingUnits.institutionId))
      .where(and(segCond, priced));
    const total = Number(countRow[0]?.total ?? 0);
    const { offset, limit, meta } = computePagination(page, pageSize, total);

    const rows = await this.db
      .select({
        numero_procedimiento: procedures.numeroProcedimiento,
        titulo: contracts.titulo,
        descripcion: contracts.descripcion,
        importe_drc: contracts.importeDrc,
        supplier_nombre: suppliers.nombre,
        supplier_rfc: suppliers.rfc,
        institucion_nombre: institutions.nombreInstitucion,
        fecha_firma: contracts.fechaFirma,
      })
      .from(contracts)
      .innerJoin(procedures, eq(procedures.id, contracts.procedureId))
      .innerJoin(
        purchasingUnits,
        eq(purchasingUnits.id, procedures.purchasingUnitId),
      )
      .innerJoin(institutions, eq(institutions.id, purchasingUnits.institutionId))
      .leftJoin(suppliers, eq(suppliers.id, contracts.supplierId))
      .where(and(segCond, priced))
      .orderBy(desc(contracts.importeDrc), desc(contracts.id))
      .limit(limit)
      .offset(offset);

    const data: ProductTopContract[] = rows.map((r) => ({
      numero_procedimiento: r.numero_procedimiento,
      titulo: r.titulo,
      descripcion: r.descripcion,
      importe_drc: toNum(r.importe_drc),
      supplier_nombre: r.supplier_nombre,
      supplier_rfc: r.supplier_rfc,
      institucion_nombre: r.institucion_nombre,
      fecha_firma: toIso(r.fecha_firma),
    }));

    return { data, pagination: meta };
  }
}

// ─────────────────────────────────────────────────────────────────── helpers ──

/** Convert a numeric(18,2) result (string | null) to a JS number. */
function toNum(v: unknown): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Normalize a Date / string column result to an ISO string (or null). */
function toIso(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}
