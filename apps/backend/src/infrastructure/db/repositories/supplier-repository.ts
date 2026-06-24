import { eq, sql, count, desc, asc } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../../db/schema/index.js';
import {
  suppliers,
  contracts,
  procedures,
  purchasingUnits,
  institutions,
} from '../../../db/schema/index.js';
import { computePagination } from '../../../application/queries/pagination.js';
import type {
  SupplierRepository,
  SupplierSearchPage,
  SupplierSearchResult,
  SupplierProfile,
  SupplierHeader,
  SupplierSummary,
  SupplierInstitution,
  SupplierTipoContratacion,
  SupplierYearBucket,
  SupplierTopContract,
  SupplierMarketPosition,
} from '../../../domain/repositories/supplier-repository.js';

type Db = NodePgDatabase<typeof schema>;

/**
 * Accent map for the DB side of the accent-insensitive search. The JS side
 * strips accents via NFD (see supplier-query.ts); here we mirror that on the
 * stored column with `translate(lower(col), FROM, TO)`. `from`/`to` are 1:1.
 * Only lowercase forms are needed (we `lower()` the column first). Covers
 * Spanish diacritics + common foreign vowels found in company names.
 */
const ACCENT_FROM = 'áàâäãåéèêëíìîïóòôöõúùûüñç';
const ACCENT_TO = 'aaaaaaeeeeiiiiooooouuuunc';

/**
 * Drizzle read-side implementation of {@link SupplierRepository} (PR9).
 *
 * Search is accent-insensitive via a translate()+lower() predicate on the
 * stored name (the `unaccent` extension is NOT installed in this DB; 2,537
 * suppliers have accented names, so naive ILIKE misses them).
 *
 * Profile runs up to 7 aggregation queries in parallel (Promise.all) scoped by
 * `supplier_id` — all hit the existing `contracts_supplier_idx` index, so even
 * the largest supplier (2,232 contracts) resolves in well under a second. The
 * market-position rank scans+groups all suppliers once (~60K groups, indexed).
 */
export class DrizzleSupplierRepository implements SupplierRepository {
  constructor(private readonly db: Db) {}

  // ───────────────────────────────────────────────────────────────── search ──

  async search(needle: string, page: number, pageSize: number): Promise<SupplierSearchPage> {
    // Accent-insensitive name substring OR case-insensitive RFC prefix.
    // `needle` is pre-normalized (lowercased, NFD-stripped, LIKE-escaped) by
    // the use case. Default LIKE escape (backslash) interprets the escaped
    // wildcards literally — no ESCAPE clause needed.
    const nameNorm = sql`translate(lower(coalesce(${suppliers.nombre}, '')), ${ACCENT_FROM}, ${ACCENT_TO})`;
    const predicate = sql`(${nameNorm} LIKE ${`%${needle}%`} OR lower(${suppliers.rfc}) LIKE ${`${needle}%`})`;

    // Total matches (scalar — counts suppliers, not contracts).
    const countRow = await this.db.select({ total: count() }).from(suppliers).where(predicate);
    const total = Number(countRow[0]?.total ?? 0);
    const { offset, limit, meta } = computePagination(page, pageSize, total);

    // LEFT JOIN contracts so suppliers with 0 contracts still appear (totals 0).
    // NULL importe_drc excluded from SUM but counted in the contract count.
    const rows = await this.db
      .select({
        id: suppliers.id,
        rfc: suppliers.rfc,
        nombre: suppliers.nombre,
        estratificacion: suppliers.estratificacion,
        total_contracts: count(contracts.id),
        total_amount: sql<string>`coalesce(sum(${contracts.importeDrc}), 0)`.as('total_amount'),
      })
      .from(suppliers)
      .leftJoin(contracts, eq(contracts.supplierId, suppliers.id))
      .where(predicate)
      .groupBy(suppliers.id, suppliers.rfc, suppliers.nombre, suppliers.estratificacion)
      .orderBy(desc(sql`total_amount`), asc(suppliers.id))
      .limit(limit)
      .offset(offset);

    const data: SupplierSearchResult[] = rows.map((r) => ({
      id: r.id,
      rfc: r.rfc,
      nombre: r.nombre,
      estratificacion: r.estratificacion,
      total_contracts: Number(r.total_contracts ?? 0),
      total_amount: toNum(r.total_amount),
    }));

    return { data, pagination: meta };
  }

  // ───────────────────────────────────────────────────────────────── profile ──

  async getProfile(rfc: string): Promise<SupplierProfile | null> {
    // Header + existence check. RFC is unique-indexed → at most one row.
    const headerRows = await this.db
      .select({
        id: suppliers.id,
        rfc: suppliers.rfc,
        nombre: suppliers.nombre,
        estratificacion: suppliers.estratificacion,
        nacionalidad: suppliers.nacionalidad,
        pais: suppliers.pais,
        folioRupc: suppliers.folioRupc,
      })
      .from(suppliers)
      .where(eq(suppliers.rfc, rfc))
      .limit(1);
    const headerRow = headerRows[0];
    if (!headerRow) return null;
    const supplierId = headerRow.id;

    const header: SupplierHeader = {
      rfc: headerRow.rfc,
      nombre: headerRow.nombre,
      estratificacion: headerRow.estratificacion,
      nacionalidad: headerRow.nacionalidad,
      pais: headerRow.pais,
      folio_rupc: headerRow.folioRupc,
    };

    // ── Wave 1: summary (needed for the rank threshold + share math) ──
    // median via percentile_cont over double-precision cast (ordered-set agg
    // skips NULLs automatically). first/last = min/max of coalesce(firma,inicio).
    const summaryRow = await this.db
      .select({
        total_contracts: count(),
        without_amount: sql<number>`count(*) FILTER (WHERE ${contracts.importeDrc} IS NULL)`,
        total_amount: sql<string>`coalesce(sum(${contracts.importeDrc}), 0)`,
        avg_amount: sql<string>`coalesce(avg(${contracts.importeDrc}), 0)`,
        median_amount: sql<string>`coalesce(percentile_cont(0.5) WITHIN GROUP (ORDER BY ${contracts.importeDrc}::double precision), 0)`,
        active_contracts: sql<number>`count(*) FILTER (WHERE ${contracts.fechaFin} IS NOT NULL AND ${contracts.fechaFin} >= current_date)`,
        first_contract: sql<string | null>`min(coalesce(${contracts.fechaFirma}, ${contracts.fechaInicio}))`,
        last_contract: sql<string | null>`max(coalesce(${contracts.fechaFirma}, ${contracts.fechaInicio}))`,
      })
      .from(contracts)
      .where(eq(contracts.supplierId, supplierId));

    const sRow = summaryRow[0];
    const totalContracts = Number(sRow?.total_contracts ?? 0);
    const totalAmount = toNum(sRow?.total_amount);

    const summary: SupplierSummary = {
      total_contracts: totalContracts,
      total_amount: totalAmount,
      avg_amount: toNum(sRow?.avg_amount),
      median_amount: toNum(sRow?.median_amount),
      // years_active derived from by_year below
      years_active: [],
      first_contract: sRow?.first_contract ?? null,
      last_contract: sRow?.last_contract ?? null,
      active_contracts: Number(sRow?.active_contracts ?? 0),
      contracts_without_amount: Number(sRow?.without_amount ?? 0),
    };

    // ── Wave 2: the 5 independent aggregations, in parallel ──
    const [instRows, tipoRows, yearRows, topRows, positionRow] = await Promise.all([
      this.byInstitution(supplierId),
      this.byTipoContratacion(supplierId),
      this.byYear(supplierId),
      this.topContracts(supplierId),
      this.marketPosition(supplierId, totalAmount),
    ]);

    // Fill years_active from the by-year buckets.
    summary.years_active = yearRows.map((y) => String(y.year));

    // Compute institution share % against the supplier's total amount.
    const byInstitution: SupplierInstitution[] = instRows.map((r) => ({
      nombre: r.nombre,
      contracts: r.contracts,
      amount: r.amount,
      share_pct: totalAmount > 0 ? round2((r.amount / totalAmount) * 100) : 0,
    }));

    const byTipoContratacion: SupplierTipoContratacion[] = tipoRows;
    const byYear: SupplierYearBucket[] = yearRows;
    const topContracts: SupplierTopContract[] = topRows;
    const marketPosition: SupplierMarketPosition | null = positionRow;

    return {
      supplier: header,
      summary,
      by_institution: byInstitution,
      by_tipo_contratacion: byTipoContratacion,
      by_year: byYear,
      top_contracts: topContracts,
      market_position: marketPosition,
    };
  }

  // ─────────────────────────────────────────────────── profile sub-queries ──

  /** Top 10 buying institutions for this supplier, ranked by amount. */
  private async byInstitution(supplierId: number): Promise<
    { nombre: string; contracts: number; amount: number }[]
  > {
    const rows = await this.db
      .select({
        nombre: institutions.nombreInstitucion,
        contracts: count(),
        amount: sql<string>`coalesce(sum(${contracts.importeDrc}), 0)`.as('amount'),
      })
      .from(contracts)
      .innerJoin(procedures, eq(procedures.id, contracts.procedureId))
      .innerJoin(purchasingUnits, eq(purchasingUnits.id, procedures.purchasingUnitId))
      .innerJoin(institutions, eq(institutions.id, purchasingUnits.institutionId))
      .where(eq(contracts.supplierId, supplierId))
      .groupBy(institutions.id, institutions.nombreInstitucion)
      .orderBy(desc(sql`amount`))
      .limit(10);
    return rows.map((r) => ({
      nombre: r.nombre,
      contracts: Number(r.contracts ?? 0),
      amount: toNum(r.amount),
    }));
  }

  /** Contract-type breakdown (ADQUISICIONES / SERVICIOS / OBRA PÚBLICA…). */
  private async byTipoContratacion(supplierId: number): Promise<SupplierTipoContratacion[]> {
    const tipoExpr = sql<string>`coalesce(${procedures.tipoContratacion}, 'SIN CLASIFICAR')`;
    const rows = await this.db
      .select({
        tipo: tipoExpr,
        contracts: count(),
        amount: sql<string>`coalesce(sum(${contracts.importeDrc}), 0)`.as('amount'),
      })
      .from(contracts)
      .innerJoin(procedures, eq(procedures.id, contracts.procedureId))
      .where(eq(contracts.supplierId, supplierId))
      .groupBy(tipoExpr)
      .orderBy(desc(sql`amount`));
    return rows.map((r) => ({
      tipo: r.tipo,
      contracts: Number(r.contracts ?? 0),
      amount: toNum(r.amount),
    }));
  }

  /** Per-year evolution (amount + count). Null-date contracts excluded. */
  private async byYear(supplierId: number): Promise<SupplierYearBucket[]> {
    const yearExpr = sql<number>`extract(year from coalesce(${contracts.fechaFirma}, ${contracts.fechaInicio}))::int`;
    const rows = await this.db
      .select({
        year: yearExpr,
        contracts: count(),
        amount: sql<string>`coalesce(sum(${contracts.importeDrc}), 0)`,
      })
      .from(contracts)
      .where(
        sql`${contracts.supplierId} = ${supplierId} AND coalesce(${contracts.fechaFirma}, ${contracts.fechaInicio}) IS NOT NULL`,
      )
      .groupBy(yearExpr)
      .orderBy(asc(yearExpr));
    return rows.map((r) => ({
      year: Number(r.year),
      contracts: Number(r.contracts ?? 0),
      amount: toNum(r.amount),
    }));
  }

  /** Top 10 contracts by amount (NULLS LAST so missing amounts sink). */
  private async topContracts(supplierId: number): Promise<SupplierTopContract[]> {
    const rows = await this.db
      .select({
        numero_procedimiento: procedures.numeroProcedimiento,
        titulo: contracts.titulo,
        descripcion: contracts.descripcion,
        importe_drc: contracts.importeDrc,
        institucion: institutions.nombreInstitucion,
        fecha_firma: contracts.fechaFirma,
        estatus_contrato: contracts.estatusContrato,
      })
      .from(contracts)
      .innerJoin(procedures, eq(procedures.id, contracts.procedureId))
      .innerJoin(purchasingUnits, eq(purchasingUnits.id, procedures.purchasingUnitId))
      .innerJoin(institutions, eq(institutions.id, purchasingUnits.institutionId))
      .where(eq(contracts.supplierId, supplierId))
      .orderBy(desc(contracts.importeDrc), desc(contracts.id))
      .limit(10);
    return rows.map((r) => ({
      numero_procedimiento: r.numero_procedimiento,
      titulo: r.titulo,
      descripcion: r.descripcion,
      importe_drc: r.importe_drc == null ? null : toNum(r.importe_drc),
      institucion: r.institucion,
      fecha_firma: toIso(r.fecha_firma),
      estatus_contrato: r.estatus_contrato,
    }));
  }

  /**
   * Market position: rank this supplier against ALL suppliers by total amount.
   *
   * Ranks every supplier once (GROUP BY supplier_id over the indexed column),
   * then counts how many have a strictly greater total. rank = that + 1.
   * Returns null when the supplier has no contracts at all (can't rank).
   */
  private async marketPosition(
    supplierId: number,
    supplierTotal: number,
  ): Promise<SupplierMarketPosition | null> {
    // The per-supplier totals are computed once in a CTE; the outer query both
    // counts them (total_suppliers) and ranks this one (rank_by_amount).
    const rows = await this.db
      .select({
        rank_by_amount: sql<number>`count(*) FILTER (WHERE grand_total > ${supplierTotal}) + 1`,
        total_suppliers: count(),
      })
      .from(
        sql`(SELECT coalesce(sum(importe_drc), 0) AS grand_total FROM contracts WHERE supplier_id IS NOT NULL GROUP BY supplier_id) per_supplier`,
      )
      .where(sql`EXISTS (SELECT 1 FROM contracts WHERE supplier_id = ${supplierId})`);
    const row = rows[0];
    if (!row) return null;
    const totalSuppliers = Number(row.total_suppliers ?? 0);
    const rankByAmount = Number(row.rank_by_amount ?? 1);
    if (totalSuppliers === 0) return null;
    // percentile: share of suppliers with LESS total amount (rank 1 → 100).
    const percentile = round2((1 - (rankByAmount - 1) / totalSuppliers) * 100);
    return {
      rank_by_amount: rankByAmount,
      total_suppliers: totalSuppliers,
      percentile,
    };
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

/** Round to 2 decimals (for percentages). */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
