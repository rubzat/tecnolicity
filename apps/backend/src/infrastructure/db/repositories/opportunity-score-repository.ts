import { eq, and, count, countDistinct, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../../db/schema/index.js';
import {
  opportunitySegmentStats,
  contracts,
  procedures,
  purchasingUnits,
  institutions,
} from '../../../db/schema/index.js';
import type {
  OpportunityScoreRepository,
  RawSegmentAggregate,
  OpportunitySegmentStats,
} from '../../../domain/repositories/opportunity-score-repository.js';

type Db = NodePgDatabase<typeof schema>;

function toStats(row: typeof opportunitySegmentStats.$inferSelect): OpportunitySegmentStats {
  return {
    tipoContratacion: row.tipoContratacion,
    siglasDependencia: row.siglasDependencia,
    sampleSize: row.sampleSize,
    medianAmount: row.medianAmount == null ? 0 : Number(row.medianAmount),
    amountScore: row.amountScore,
    distinctSuppliers: row.distinctSuppliers,
    competitionScore: row.competitionScore,
    dominantSupplierShare: row.dominantSupplierShare == null ? null : Number(row.dominantSupplierShare),
    isDominated: row.isDominated,
    score: row.score,
  };
}

export class DrizzleOpportunityScoreRepository implements OpportunityScoreRepository {
  constructor(private readonly db: Db) {}

  async computeRawSegmentAggregates(): Promise<RawSegmentAggregate[]> {
    // La llave del segmento es el ACRÓNIMO de la institución (`institutions.siglas`,
    // p.ej. 'BUAP'), NO su código presupuestal (`clave_institucion`, p.ej. '080V26'):
    // es `institutions.siglas` lo que corresponde a `vigente_procedures.siglas_dependencia`,
    // contra el que se hace el LEFT JOIN en DrizzleVigenteRepository.list().
    // `siglas` es nullable, así que se filtran los NULL: un segmento con siglas NULL
    // jamás casaría con una vigente y sólo ensuciaría la normalización min-max.
    const segmentRows = await this.db
      .select({
        tipoContratacion: procedures.tipoContratacion,
        siglas: institutions.siglas,
        sampleSize: count(contracts.id),
        medianAmount: sql<string>`percentile_cont(0.5) WITHIN GROUP (ORDER BY ${contracts.importeDrc}::double precision)`,
        distinctSuppliers: countDistinct(contracts.supplierId),
      })
      .from(contracts)
      .innerJoin(procedures, eq(procedures.id, contracts.procedureId))
      .innerJoin(purchasingUnits, eq(purchasingUnits.id, procedures.purchasingUnitId))
      .innerJoin(institutions, eq(institutions.id, purchasingUnits.institutionId))
      .where(and(sql`${procedures.tipoContratacion} IS NOT NULL`, sql`${institutions.siglas} IS NOT NULL`))
      .groupBy(procedures.tipoContratacion, institutions.siglas);

    // Dominancia: % del proveedor con más monto dentro de cada segmento.
    const ranked = this.db
      .select({
        tipoContratacion: procedures.tipoContratacion,
        siglas: institutions.siglas,
        supplierAmount: sql<string>`coalesce(sum(${contracts.importeDrc}), 0)`.as('supplier_amount'),
        segmentTotalAmount: sql<string>`sum(sum(${contracts.importeDrc})) over (partition by ${procedures.tipoContratacion}, ${institutions.siglas})`.as(
          'segment_total_amount',
        ),
        rn: sql<number>`row_number() over (partition by ${procedures.tipoContratacion}, ${institutions.siglas} order by sum(${contracts.importeDrc}) desc nulls last)`.as(
          'rn',
        ),
      })
      .from(contracts)
      .innerJoin(procedures, eq(procedures.id, contracts.procedureId))
      .innerJoin(purchasingUnits, eq(purchasingUnits.id, procedures.purchasingUnitId))
      .innerJoin(institutions, eq(institutions.id, purchasingUnits.institutionId))
      .where(
        and(
          sql`${procedures.tipoContratacion} IS NOT NULL`,
          sql`${institutions.siglas} IS NOT NULL`,
          sql`${contracts.supplierId} IS NOT NULL`,
        ),
      )
      .groupBy(procedures.tipoContratacion, institutions.siglas, contracts.supplierId)
      .as('ranked');

    const dominanceRows = await this.db
      .select({
        tipoContratacion: ranked.tipoContratacion,
        siglas: ranked.siglas,
        dominantSharePct: sql<string>`round(100.0 * ${ranked.supplierAmount} / nullif(${ranked.segmentTotalAmount}, 0), 2)`,
      })
      .from(ranked)
      .where(eq(ranked.rn, 1));

    // `dominantSharePct` es SQL NULL cuando el total del segmento es 0 —
    // `Number(null)` sería 0, que el contrato del puerto distingue de null
    // ("null si no hay proveedor con monto"), así que se preserva el null.
    const dominanceBySegment = new Map<string, number | null>();
    for (const d of dominanceRows) {
      dominanceBySegment.set(
        `${d.tipoContratacion}::${d.siglas}`,
        d.dominantSharePct == null ? null : Number(d.dominantSharePct),
      );
    }

    return segmentRows.map((r) => ({
      tipoContratacion: r.tipoContratacion!,
      siglasDependencia: r.siglas!,
      sampleSize: Number(r.sampleSize ?? 0),
      medianAmount: r.medianAmount == null ? 0 : Number(r.medianAmount),
      distinctSuppliers: Number(r.distinctSuppliers ?? 0),
      dominantSupplierShare: dominanceBySegment.get(`${r.tipoContratacion}::${r.siglas}`) ?? null,
    }));
  }

  async upsertSegment(stats: OpportunitySegmentStats): Promise<void> {
    await this.db
      .insert(opportunitySegmentStats)
      .values({
        tipoContratacion: stats.tipoContratacion,
        siglasDependencia: stats.siglasDependencia,
        sampleSize: stats.sampleSize,
        medianAmount: String(stats.medianAmount),
        amountScore: stats.amountScore,
        distinctSuppliers: stats.distinctSuppliers,
        competitionScore: stats.competitionScore,
        dominantSupplierShare: stats.dominantSupplierShare == null ? null : String(stats.dominantSupplierShare),
        isDominated: stats.isDominated,
        score: stats.score,
        computedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [opportunitySegmentStats.tipoContratacion, opportunitySegmentStats.siglasDependencia],
        set: {
          sampleSize: sql`excluded.sample_size`,
          medianAmount: sql`excluded.median_amount`,
          amountScore: sql`excluded.amount_score`,
          distinctSuppliers: sql`excluded.distinct_suppliers`,
          competitionScore: sql`excluded.competition_score`,
          dominantSupplierShare: sql`excluded.dominant_supplier_share`,
          isDominated: sql`excluded.is_dominated`,
          score: sql`excluded.score`,
          // `computedAt` maps to the DB column `created_at` — the schema
          // (Task 1) reuses the shared `createdAt()` helper, which hardcodes
          // the physical column name regardless of the TS property name.
          computedAt: sql`excluded.created_at`,
        },
      });
  }

  async findBySegment(tipoContratacion: string, siglasDependencia: string): Promise<OpportunitySegmentStats | null> {
    const [row] = await this.db
      .select()
      .from(opportunitySegmentStats)
      .where(
        and(
          eq(opportunitySegmentStats.tipoContratacion, tipoContratacion),
          eq(opportunitySegmentStats.siglasDependencia, siglasDependencia),
        ),
      )
      .limit(1);
    return row ? toStats(row) : null;
  }
}
