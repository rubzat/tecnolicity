import {
  and,
  eq,
  gte,
  lte,
  sql,
  count,
  countDistinct,
  desc,
  asc,
  type SQL,
} from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../../db/schema/index.js';
import {
  procedures,
  purchasingUnits,
  institutions,
  suppliers,
  expedientes,
  contracts,
} from '../../../db/schema/index.js';
import { buildProcedureSegmentCondition } from '../../../application/market/procedure-segment.js';
import { computePagination } from '../../../application/queries/pagination.js';
import type {
  MarketRepository,
  MarketOverview,
  MarketCompetitor,
  MarketBuyer,
  MarketOpportunity,
  MarketOpportunityPage,
  MarketExpiringContract,
  MarketDominance,
} from '../../../domain/repositories/market-repository.js';

type Db = NodePgDatabase<typeof schema>;

/**
 * Drizzle read-side implementation of {@link MarketRepository}.
 *
 * Every query scopes to a market segment via the `segmentMatchesProcedure`
 * helper: a `procedures.id IN (UNION …)` clause where each UNION branch matches
 * one text column with `to_tsvector('simple', col) @@ to_tsquery('simple', …)`,
 * using the tsvector GIN index (see segment-matcher.ts for the perf rationale).
 */
export class DrizzleMarketRepository implements MarketRepository {
  constructor(private readonly db: Db) {}

  // ───────────────────────────────────────────────────────────── overview ──

  async overview(pattern: string): Promise<MarketOverview> {
    const segCond = this.segmentMatchesProcedure(pattern);

    const row = await this.db
      .select({
        total_contracts: count(contracts.id),
        total_amount: sql<string>`coalesce(sum(${contracts.importeDrc}), 0)`,
        unique_suppliers: countDistinct(contracts.supplierId),
        unique_buyers: countDistinct(institutions.id),
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
      .where(segCond);

    const totalContracts = Number(row[0]?.total_contracts ?? 0);
    const totalAmount = toNum(row[0]?.total_amount);
    const avgAmount = totalContracts === 0 ? 0 : totalAmount / totalContracts;

    // By-year trend — extract year from procedure fecha_publicacion (fall back
    // to fecha_apertura). The year expression is repeated in GROUP BY/ORDER BY
    // (not referenced by output alias) because it is a SQL fragment, not a
    // declared `.as(...)` column.
    const yearExpr = sql<number>`extract(year from coalesce(${procedures.fechaPublicacion}, ${procedures.fechaApertura}))::int`;
    const yearRows = await this.db
      .select({
        year: yearExpr,
        contracts: count(contracts.id),
        amount: sql<string>`coalesce(sum(${contracts.importeDrc}), 0)`,
      })
      .from(contracts)
      .innerJoin(procedures, eq(procedures.id, contracts.procedureId))
      .innerJoin(
        purchasingUnits,
        eq(purchasingUnits.id, procedures.purchasingUnitId),
      )
      .innerJoin(institutions, eq(institutions.id, purchasingUnits.institutionId))
      .where(segCond)
      .groupBy(yearExpr)
      .orderBy(asc(yearExpr));

    return {
      total_contracts: totalContracts,
      total_amount: totalAmount,
      avg_amount: avgAmount,
      unique_suppliers: Number(row[0]?.unique_suppliers ?? 0),
      unique_buyers: Number(row[0]?.unique_buyers ?? 0),
      by_year: yearRows.map((y) => ({
        year: Number(y.year),
        contracts: Number(y.contracts ?? 0),
        amount: toNum(y.amount),
      })),
    };
  }

  // ─────────────────────────────────────────────────────────── competitors ──

  async competitors(
    pattern: string,
    limit: number,
  ): Promise<MarketCompetitor[]> {
    const segCond = this.segmentMatchesProcedure(pattern);

    // Aggregate per supplier, then compute market share against the segment
    // total in the same query (window function) so a second round-trip is
    // avoided. NULL importe_drc excluded from SUM but counted in contract count.
    const rows = await this.db
      .select({
        rfc: suppliers.rfc,
        nombre: suppliers.nombre,
        contracts_count: count(contracts.id),
        total_amount: sql<string>`coalesce(sum(${contracts.importeDrc}), 0)`.as('total_amount'),
        avg_amount: sql<string>`coalesce(avg(${contracts.importeDrc}), 0)`,
        unique_buyers: countDistinct(institutions.id),
        market_share_pct: sql<number>`
          round(
            100.0 * coalesce(sum(${contracts.importeDrc}), 0)
            / nullif(sum(sum(${contracts.importeDrc})) over (), 0),
            2
          )
        `.as('market_share_pct'),
      })
      .from(contracts)
      .innerJoin(procedures, eq(procedures.id, contracts.procedureId))
      .innerJoin(
        purchasingUnits,
        eq(purchasingUnits.id, procedures.purchasingUnitId),
      )
      .innerJoin(institutions, eq(institutions.id, purchasingUnits.institutionId))
      .innerJoin(suppliers, eq(suppliers.id, contracts.supplierId))
      .where(segCond)
      .groupBy(suppliers.id, suppliers.rfc, suppliers.nombre)
      .orderBy(desc(sql`total_amount`))
      .limit(limit);

    return rows.map((r) => ({
      nombre: r.nombre,
      rfc: r.rfc,
      contracts_count: Number(r.contracts_count ?? 0),
      total_amount: toNum(r.total_amount),
      avg_amount: toNum(r.avg_amount),
      unique_buyers: Number(r.unique_buyers ?? 0),
      market_share_pct: Number(r.market_share_pct ?? 0),
    }));
  }

  // ─────────────────────────────────────────────────────────────── buyers ──

  async buyers(pattern: string, limit: number): Promise<MarketBuyer[]> {
    const segCond = this.segmentMatchesProcedure(pattern);

    // Per (institution, supplier) rollup with window aggregates. `rn = 1`
    // picks each institution's top supplier (by amount). The institution totals
    // (amount, unique suppliers, contracts) come from partitioned windows so a
    // second round-trip is avoided. NULL suppliers are excluded (left join →
    // inner) so `unique_suppliers` counts only real ones.
    const ranked = this.db
      .select({
        institution_id: institutions.id,
        institution_nombre: institutions.nombreInstitucion,
        institution_clave: institutions.claveInstitucion,
        supplier_nombre: suppliers.nombre,
        supplier_rfc: suppliers.rfc,
        supplier_amount: sql<string>`coalesce(sum(${contracts.importeDrc}), 0)`.as(
          'supplier_amount',
        ),
        inst_total_amount: sql<string>`sum(sum(${contracts.importeDrc})) over (partition by ${institutions.id})`.as(
          'inst_total_amount',
        ),
        inst_contracts: sql<number>`sum(count(${contracts.id})) over (partition by ${institutions.id})`.as(
          'inst_contracts',
        ),
        inst_unique_suppliers: sql<number>`count(*) over (partition by ${institutions.id})`.as(
          'inst_unique_suppliers',
        ),
        rn: sql<number>`row_number() over (partition by ${institutions.id} order by sum(${contracts.importeDrc}) desc nulls last)`.as(
          'rn',
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
      .where(segCond)
      .groupBy(
        institutions.id,
        institutions.nombreInstitucion,
        institutions.claveInstitucion,
        suppliers.id,
        suppliers.rfc,
        suppliers.nombre,
      )
      .as('ranked');

    const rows = await this.db
      .select({
        nombre: ranked.institution_nombre,
        clave: ranked.institution_clave,
        contracts_count: ranked.inst_contracts,
        total_amount: sql<string>`coalesce(${ranked.inst_total_amount}, 0)`.as('total_amount'),
        unique_suppliers: ranked.inst_unique_suppliers,
        top_supplier_nombre: ranked.supplier_nombre,
        top_supplier_rfc: ranked.supplier_rfc,
        top_supplier_pct: sql<number>`round(100.0 * ${ranked.supplier_amount} / nullif(${ranked.inst_total_amount}, 0), 2)`,
      })
      .from(ranked)
      .where(eq(ranked.rn, 1))
      .orderBy(desc(sql`total_amount`))
      .limit(limit);

    return rows.map((r) => ({
      nombre: r.nombre,
      clave: r.clave,
      contracts_count: Number(r.contracts_count ?? 0),
      total_amount: toNum(r.total_amount),
      unique_suppliers: Number(r.unique_suppliers ?? 0),
      top_supplier:
        r.top_supplier_nombre != null
          ? {
              nombre: r.top_supplier_nombre,
              rfc: r.top_supplier_rfc ?? '',
              market_share_pct: Number(r.top_supplier_pct ?? 0),
            }
          : null,
    }));
  }

  // ───────────────────────────────────────────────────────── opportunities ──

  async opportunities(
    pattern: string,
    page: number,
    pageSize: number,
  ): Promise<MarketOpportunityPage> {
    const segCond = this.segmentMatchesProcedure(pattern);

    // DATA REALITY: procedures.estatus is 99.999% 'PUBLICADO' and there are 0
    // future fecha_apertura values (historical snapshot, max 2026-06-19). So
    // the "open procedure / could bid on" filter cannot use estatus. We define
    // an opportunity as a RECENTLY OPENED procedure (last 90 days) — the
    // freshest leads the user can investigate. Sorted by fecha_apertura DESC
    // (most recent first). Documented deviation from the original spec.
    const recentWindow = sql`now() - interval '90 days'`;

    const countRow = await this.db
      .select({ total: countDistinct(procedures.id) })
      .from(procedures)
      .innerJoin(
        purchasingUnits,
        eq(purchasingUnits.id, procedures.purchasingUnitId),
      )
      .innerJoin(institutions, eq(institutions.id, purchasingUnits.institutionId))
      .where(and(segCond, gte(procedures.fechaApertura, recentWindow)));
    const total = Number(countRow[0]?.total ?? 0);
    const { offset, limit, meta } = computePagination(page, pageSize, total);

    const rows = await this.db
      .select({
        numero_procedimiento: procedures.numeroProcedimiento,
        descripcion: procedures.descripcion,
        tipo_contratacion: procedures.tipoContratacion,
        estatus: procedures.estatus,
        fecha_apertura: procedures.fechaApertura,
        fecha_fallo: procedures.fechaFallo,
        institucion_nombre: institutions.nombreInstitucion,
        institucion_clave: institutions.claveInstitucion,
        importe_estimado: sql<string>`(
          select coalesce(sum(c2.importe_drc), 0) from contracts c2
          where c2.procedure_id = ${procedures.id}
        )`,
      })
      .from(procedures)
      .innerJoin(
        purchasingUnits,
        eq(purchasingUnits.id, procedures.purchasingUnitId),
      )
      .innerJoin(institutions, eq(institutions.id, purchasingUnits.institutionId))
      .where(and(segCond, gte(procedures.fechaApertura, recentWindow)))
      .orderBy(desc(procedures.fechaApertura), asc(procedures.id))
      .limit(limit)
      .offset(offset);

    const data: MarketOpportunity[] = rows.map((r) => ({
      numero_procedimiento: r.numero_procedimiento,
      descripcion: r.descripcion,
      tipo_contratacion: r.tipo_contratacion,
      estatus: r.estatus,
      fecha_apertura: toIso(r.fecha_apertura),
      fecha_fallo: toIso(r.fecha_fallo),
      institucion_nombre: r.institucion_nombre,
      institucion_clave: r.institucion_clave,
      importe_estimado: toNum(r.importe_estimado),
    }));

    return { data, pagination: meta };
  }

  // ───────────────────────────────────────────────────────────── expiring ──

  async expiring(
    pattern: string,
    months: number,
    limit: number,
  ): Promise<MarketExpiringContract[]> {
    const segCond = this.segmentMatchesProcedure(pattern);

    // Contracts ending within the next `months` months. fecha_fin is a `date`,
    // compared against now() (timestamptz cast). NULL fecha_fin excluded.
    const upper = sql`now() + interval '${sql.raw(String(months))} months'`;

    const rows = await this.db
      .select({
        contrato_id: contracts.id,
        numero_contrato: contracts.numeroContrato,
        titulo: contracts.titulo,
        importe_drc: contracts.importeDrc,
        fecha_fin: contracts.fechaFin,
        supplier_rfc: suppliers.rfc,
        supplier_nombre: suppliers.nombre,
        institucion_nombre: institutions.nombreInstitucion,
        institucion_clave: institutions.claveInstitucion,
        numero_procedimiento: procedures.numeroProcedimiento,
      })
      .from(contracts)
      .innerJoin(procedures, eq(procedures.id, contracts.procedureId))
      .innerJoin(
        purchasingUnits,
        eq(purchasingUnits.id, procedures.purchasingUnitId),
      )
      .innerJoin(institutions, eq(institutions.id, purchasingUnits.institutionId))
      .leftJoin(suppliers, eq(suppliers.id, contracts.supplierId))
      .where(
        and(
          segCond,
          sql`${contracts.fechaFin} IS NOT NULL`,
          gte(contracts.fechaFin, sql`now()::date`),
          lte(contracts.fechaFin, upper),
        ),
      )
      .orderBy(asc(contracts.fechaFin))
      .limit(limit);

    return rows.map((r) => ({
      contrato_id: r.contrato_id,
      numero_contrato: r.numero_contrato,
      titulo: r.titulo,
      importe_drc: r.importe_drc == null ? null : toNum(r.importe_drc),
      fecha_fin: toIso(r.fecha_fin),
      supplier:
        r.supplier_rfc != null
          ? { rfc: r.supplier_rfc, nombre: r.supplier_nombre ?? r.supplier_rfc }
          : null,
      institucion_nombre: r.institucion_nombre,
      institucion_clave: r.institucion_clave,
      numero_procedimiento: r.numero_procedimiento,
    }));
  }

  // ──────────────────────────────────────────────────────────── dominance ──

  async dominance(
    pattern: string,
    limit: number,
  ): Promise<MarketDominance[]> {
    const segCond = this.segmentMatchesProcedure(pattern);

    // Per (institution, supplier) rollup, enriched with window aggregates so we
    // can rank suppliers within each institution AND read the institution totals
    // in one pass. `rn = 1` selects each institution's top supplier; the share
    // filter (>=60%) keeps only "dominant" relationships.
    const ranked = this.db
      .select({
        institution_id: institutions.id,
        institution_nombre: institutions.nombreInstitucion,
        institution_clave: institutions.claveInstitucion,
        supplier_nombre: suppliers.nombre,
        supplier_rfc: suppliers.rfc,
        supplier_amount: sql<string>`coalesce(sum(${contracts.importeDrc}), 0)`.as(
          'supplier_amount',
        ),
        supplier_contracts: count(contracts.id),
        inst_total_amount: sql<string>`sum(sum(${contracts.importeDrc})) over (partition by ${institutions.id})`.as(
          'inst_total_amount',
        ),
        inst_total_contracts: sql<number>`sum(count(${contracts.id})) over (partition by ${institutions.id})`.as(
          'inst_total_contracts',
        ),
        rn: sql<number>`row_number() over (partition by ${institutions.id} order by sum(${contracts.importeDrc}) desc nulls last)`.as(
          'rn',
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
      .where(segCond)
      .groupBy(
        institutions.id,
        institutions.nombreInstitucion,
        institutions.claveInstitucion,
        suppliers.id,
        suppliers.rfc,
        suppliers.nombre,
      )
      .as('ranked');

    const rows = await this.db
      .select({
        institution_nombre: ranked.institution_nombre,
        institution_clave: ranked.institution_clave,
        dominant_supplier_nombre: ranked.supplier_nombre,
        dominant_supplier_rfc: ranked.supplier_rfc,
        dominant_share_pct: sql<number>`round(100.0 * ${ranked.supplier_amount} / nullif(${ranked.inst_total_amount}, 0), 2)`.as('dominant_share_pct'),
        total_amount: sql<string>`coalesce(${ranked.inst_total_amount}, 0)`,
        contracts_count: ranked.inst_total_contracts,
      })
      .from(ranked)
      .where(
        and(
          eq(ranked.rn, 1),
          sql`100.0 * ${ranked.supplier_amount} / nullif(${ranked.inst_total_amount}, 0) >= 60`,
        ),
      )
      .orderBy(desc(sql`dominant_share_pct`))
      .limit(limit);

    return rows.map((r) => ({
      institution_nombre: r.institution_nombre,
      institution_clave: r.institution_clave,
      dominant_supplier_nombre: r.dominant_supplier_nombre,
      dominant_supplier_rfc: r.dominant_supplier_rfc,
      dominant_share_pct: Number(r.dominant_share_pct ?? 0),
      total_amount: toNum(r.total_amount),
      contracts_count: Number(r.contracts_count ?? 0),
    }));
  }

  // ────────────────────────────────────────────── shared segment clause ──

  /**
   * Build the segment condition applied at the PROCEDURE level. Delegates to
   * the shared {@link buildProcedureSegmentCondition} helper (extracted so the
   * Product Intelligence module can reuse the exact same matcher). See that
   * helper for the performance rationale (UNION subquery + tsvector GIN).
   */
  private segmentMatchesProcedure(pattern: string): SQL {
    return buildProcedureSegmentCondition(pattern);
  }
}

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
  const s = String(v);
  return s;
}
