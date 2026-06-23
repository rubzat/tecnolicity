import {
  and,
  eq,
  gte,
  lte,
  or,
  ilike,
  inArray,
  desc,
  asc,
  sql,
  count,
  countDistinct,
  type SQL,
} from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { ProcedureFilter } from '@tecnolicity/shared';
import * as schema from '../../../db/schema/index.js';
import {
  procedures,
  purchasingUnits,
  institutions,
  suppliers,
  expedientes,
  contracts,
  contractAmounts,
} from '../../../db/schema/index.js';
import {
  computePagination,
  resolveSort,
} from '../../../application/queries/pagination.js';
import type {
  ProcedureQueryRepository,
  ProcedureListItem,
  ProcedureListPage,
  ProcedureDetail,
  ExpedienteView,
  ContractView,
  AmountView,
  SupplierView,
  AnalyticsSummary,
  InstitucionGroup,
  TipoGroup,
  SupplierGroup,
  AnalyticsParams,
} from '../../../domain/repositories/procedure-query-repository.js';

type Db = NodePgDatabase<typeof schema>;

/**
 * Drizzle read-side implementation of {@link ProcedureQueryRepository}.
 *
 * All list + analytics queries share a single filter builder (`buildConditions`)
 * so that analytics respect EXACTLY the same filters as the procedure list (CA-6).
 *
 * Amount semantics (documented decision): a procedure is in scope of the
 * `monto_min`/`monto_max` filter when it has ≥1 contract whose `importe_drc`
 * falls in the range. A procedure's `importe_total` is the SUM of ALL its
 * contracts (not just those in range), so ranked totals stay consistent.
 */
export class DrizzleProcedureQueryRepository implements ProcedureQueryRepository {
  constructor(private readonly db: Db) {}

  // ─────────────────────────────────────────────────────────── listing (PQ-1..3)

  async list(
    filters: ProcedureFilter,
    page: number,
    pageSize: number,
    sort: string,
    order: 'asc' | 'desc',
  ): Promise<ProcedureListPage> {
    const conditions = this.buildConditions(filters);

    // Total count — no contracts join (avoids row multiplication).
    const countQb = this.db
      .select({ total: count() })
      .from(procedures)
      .innerJoin(purchasingUnits, eq(purchasingUnits.id, procedures.purchasingUnitId))
      .innerJoin(institutions, eq(institutions.id, purchasingUnits.institutionId));
    if (conditions.length) countQb.where(and(...conditions));
    const countRow = await countQb;
    const total = Number(countRow[0]?.total ?? 0);

    const { offset, limit, meta } = computePagination(page, pageSize, total);
    const { orderBy } = resolveSort(sort, order);

    // NOTE: the WHERE clause is applied here too (not just to the count query),
    // and a deterministic `procedures.id` tiebreaker is appended so pagination
    // is stable even when many rows share the same sort key (e.g. null dates).
    const dataQb = this.db
      .select({
        id: procedures.id,
        numero_procedimiento: procedures.numeroProcedimiento,
        descripcion: procedures.descripcion,
        caracter: procedures.caracter,
        tipo_contratacion: procedures.tipoContratacion,
        tipo_procedimiento: procedures.tipoProcedimiento,
        ley: procedures.ley,
        estatus: procedures.estatus,
        fecha_publicacion: procedures.fechaPublicacion,
        fecha_apertura: procedures.fechaApertura,
        fecha_fallo: procedures.fechaFallo,
        importe_total: sql<string>`coalesce(sum(${contracts.importeDrc}), 0)`.as(
          'importe_total',
        ),
        institucion_nombre: institutions.nombreInstitucion,
        institucion_clave: institutions.claveInstitucion,
        institucion_siglas: institutions.siglas,
        uc_nombre: purchasingUnits.nombreUc,
        uc_clave: purchasingUnits.claveUc,
      })
      .from(procedures)
      .innerJoin(purchasingUnits, eq(purchasingUnits.id, procedures.purchasingUnitId))
      .innerJoin(institutions, eq(institutions.id, purchasingUnits.institutionId))
      .leftJoin(contracts, eq(contracts.procedureId, procedures.id))
      .where(conditions.length ? and(...conditions) : undefined)
      .groupBy(
        procedures.id,
        institutions.id,
        institutions.nombreInstitucion,
        institutions.claveInstitucion,
        institutions.siglas,
        purchasingUnits.id,
        purchasingUnits.nombreUc,
        purchasingUnits.claveUc,
      )
      // Secondary key guarantees stable ordering across pages (id is unique).
      .orderBy(orderBy, asc(procedures.id))
      .limit(limit)
      .offset(offset);
    const rows = await dataQb;

    const data: ProcedureListItem[] = rows.map((r) => ({
      id: r.id,
      numero_procedimiento: r.numero_procedimiento,
      descripcion: r.descripcion,
      caracter: r.caracter,
      tipo_contratacion: r.tipo_contratacion,
      tipo_procedimiento: r.tipo_procedimiento,
      ley: r.ley,
      estatus: r.estatus,
      fecha_publicacion: r.fecha_publicacion,
      fecha_apertura: r.fecha_apertura,
      fecha_fallo: r.fecha_fallo,
      importe_total: toNum(r.importe_total),
      institucion: {
        nombre: r.institucion_nombre,
        clave: r.institucion_clave,
        siglas: r.institucion_siglas,
      },
      unidad_compradora: { nombre: r.uc_nombre, clave: r.uc_clave },
    }));

    return { data, pagination: meta };
  }

  // ─────────────────────────────────────────────────────────── detail (PQ-4/5)

  async getDetail(numeroProcedimiento: string): Promise<ProcedureDetail | null> {
    const head = await this.db
      .select({
        id: procedures.id,
        numero_procedimiento: procedures.numeroProcedimiento,
        descripcion: procedures.descripcion,
        caracter: procedures.caracter,
        tipo_contratacion: procedures.tipoContratacion,
        tipo_procedimiento: procedures.tipoProcedimiento,
        ley: procedures.ley,
        estatus: procedures.estatus,
        forma_participacion: procedures.formaParticipacion,
        fecha_publicacion: procedures.fechaPublicacion,
        fecha_apertura: procedures.fechaApertura,
        fecha_fallo: procedures.fechaFallo,
        direccion_anuncio: procedures.direccionAnuncio,
        contrato_marco: procedures.contratoMarco,
        compra_consolidada: procedures.compraConsolidada,
        credito_externo: procedures.creditoExterno,
        inst_clave: institutions.claveInstitucion,
        inst_nombre: institutions.nombreInstitucion,
        inst_siglas: institutions.siglas,
        inst_orden: institutions.ordenGobierno,
        inst_clave_ramo: institutions.claveRamo,
        inst_desc_ramo: institutions.descripcionRamo,
        uc_clave: purchasingUnits.claveUc,
        uc_nombre: purchasingUnits.nombreUc,
      })
      .from(procedures)
      .innerJoin(purchasingUnits, eq(purchasingUnits.id, procedures.purchasingUnitId))
      .innerJoin(institutions, eq(institutions.id, purchasingUnits.institutionId))
      .where(eq(procedures.numeroProcedimiento, numeroProcedimiento))
      .limit(1);

    const h = head[0];
    if (!h) return null; // PQ-5: 404 on unknown
    const procedureId = h.id;

    const [expRows, contractRows] = await Promise.all([
      this.db
        .select({
          codigo_expediente: expedientes.codigoExpediente,
          referencia: expedientes.referencia,
          titulo: expedientes.titulo,
          partida_especifica: expedientes.partidaEspecifica,
        })
        .from(expedientes)
        .where(eq(expedientes.procedureId, procedureId)),
      this.db
        .select({
          id: contracts.id,
          codigo_contrato: contracts.codigoContrato,
          numero_contrato: contracts.numeroContrato,
          titulo: contracts.titulo,
          descripcion: contracts.descripcion,
          importe_drc: contracts.importeDrc,
          moneda: contracts.moneda,
          estatus_drc: contracts.estatusDrc,
          tipo_contrato: contracts.tipoContrato,
          contrato_plurianual: contracts.contratoPlurianual,
          convenio_modificatorio: contracts.convenioModificatorio,
          fecha_inicio: contracts.fechaInicio,
          fecha_fin: contracts.fechaFin,
          fecha_firma: contracts.fechaFirma,
          supplier_rfc: suppliers.rfc,
          supplier_nombre: suppliers.nombre,
          supplier_folio: suppliers.folioRupc,
          supplier_pais: suppliers.pais,
          supplier_estrato: suppliers.estratificacion,
          amount_id: contractAmounts.id,
          amount_tipo: contractAmounts.tipo,
          amount_sin_min: contractAmounts.montoSinImpMin,
          amount_con_min: contractAmounts.montoConImpMin,
          amount_sin_max: contractAmounts.montoSinImpMax,
          amount_con_max: contractAmounts.montoConImpMax,
          amount_moneda: contractAmounts.moneda,
          amount_codigo_ref: contractAmounts.codigoRef,
          amount_fecha_fin: contractAmounts.fechaFinConvenio,
        })
        .from(contracts)
        .leftJoin(suppliers, eq(suppliers.id, contracts.supplierId))
        .leftJoin(
          contractAmounts,
          eq(contractAmounts.contractId, contracts.id),
        )
        .where(eq(contracts.procedureId, procedureId)),
    ]);

    // Collapse the contract × amount LEFT JOIN back to one row per contract.
    const byContract = new Map<number, ContractView>();
    for (const r of contractRows) {
      let c = byContract.get(r.id);
      if (!c) {
        const supplier: SupplierView | null = r.supplier_rfc
          ? {
              rfc: r.supplier_rfc,
              // nombre is NOT NULL in the schema; LEFT JOIN widens it to nullable.
              nombre: r.supplier_nombre ?? r.supplier_rfc,
              folio_rupc: r.supplier_folio,
              pais: r.supplier_pais,
              estratificacion: r.supplier_estrato,
            }
          : null;
        c = {
          id: r.id,
          codigo_contrato: r.codigo_contrato,
          numero_contrato: r.numero_contrato,
          titulo: r.titulo,
          descripcion: r.descripcion,
          importe_drc: r.importe_drc == null ? null : toNum(r.importe_drc),
          moneda: r.moneda,
          estatus_drc: r.estatus_drc,
          tipo_contrato: r.tipo_contrato,
          contrato_plurianual: r.contrato_plurianual,
          convenio_modificatorio: r.convenio_modificatorio,
          fecha_inicio: r.fecha_inicio,
          fecha_fin: r.fecha_fin,
          fecha_firma: r.fecha_firma,
          supplier,
          amounts: [],
        };
        byContract.set(r.id, c);
      }
      if (r.amount_id != null) {
        const amt: AmountView = {
          // enum has NOT NULL DEFAULT 'original' — safe inside this branch.
          tipo: r.amount_tipo ?? 'original',
          monto_sin_imp_min: r.amount_sin_min == null ? null : toNum(r.amount_sin_min),
          monto_con_imp_min: r.amount_con_min == null ? null : toNum(r.amount_con_min),
          monto_sin_imp_max: r.amount_sin_max == null ? null : toNum(r.amount_sin_max),
          monto_con_imp_max: r.amount_con_max == null ? null : toNum(r.amount_con_max),
          moneda: r.amount_moneda ?? 'MXN',
          codigo_ref: r.amount_codigo_ref,
          fecha_fin_convenio: r.amount_fecha_fin,
        };
        c.amounts.push(amt);
      }
    }

    return {
      id: h.id,
      numero_procedimiento: h.numero_procedimiento,
      descripcion: h.descripcion,
      caracter: h.caracter,
      tipo_contratacion: h.tipo_contratacion,
      tipo_procedimiento: h.tipo_procedimiento,
      ley: h.ley,
      estatus: h.estatus,
      forma_participacion: h.forma_participacion,
      fecha_publicacion: h.fecha_publicacion,
      fecha_apertura: h.fecha_apertura,
      fecha_fallo: h.fecha_fallo,
      direccion_anuncio: h.direccion_anuncio,
      contrato_marco: h.contrato_marco,
      compra_consolidada: h.compra_consolidada,
      credito_externo: h.credito_externo,
      institucion: {
        clave: h.inst_clave,
        nombre: h.inst_nombre,
        siglas: h.inst_siglas,
        orden_gobierno: h.inst_orden,
        clave_ramo: h.inst_clave_ramo,
        descripcion_ramo: h.inst_desc_ramo,
      },
      unidad_compradora: { clave: h.uc_clave, nombre: h.uc_nombre },
      expedientes: expRows as ExpedienteView[],
      contracts: [...byContract.values()],
    };
  }

  // ─────────────────────────────────────────────────────────── analytics (CA)

  async summary(filters: ProcedureFilter): Promise<AnalyticsSummary> {
    const conditions = this.buildConditions(filters);

    const baseFrom = this.db
      .select({
        total_procedimientos: countDistinct(procedures.id),
        total_contratos: count(contracts.id),
        total_monto: sql<string>`coalesce(sum(${contracts.importeDrc}), 0)`,
        bucket_lt_100k: sql<number>`count(*) filter (where ${contracts.importeDrc} is not null and ${contracts.importeDrc} < 100000)`,
        bucket_100k_1m: sql<number>`count(*) filter (where ${contracts.importeDrc} is not null and ${contracts.importeDrc} >= 100000 and ${contracts.importeDrc} < 1000000)`,
        bucket_1m_10m: sql<number>`count(*) filter (where ${contracts.importeDrc} is not null and ${contracts.importeDrc} >= 1000000 and ${contracts.importeDrc} < 10000000)`,
        bucket_gt_10m: sql<number>`count(*) filter (where ${contracts.importeDrc} is not null and ${contracts.importeDrc} >= 10000000)`,
      })
      .from(procedures)
      .innerJoin(purchasingUnits, eq(purchasingUnits.id, procedures.purchasingUnitId))
      .innerJoin(institutions, eq(institutions.id, purchasingUnits.institutionId))
      .leftJoin(contracts, eq(contracts.procedureId, procedures.id));
    if (conditions.length) baseFrom.where(and(...conditions));
    const row = await baseFrom;

    const totalMonto = toNum(row[0]?.total_monto);
    const totalContratos = Number(row[0]?.total_contratos ?? 0);
    const totalProcedimientos = Number(row[0]?.total_procedimientos ?? 0);

    // Count by estatus (CA-5) — separate aggregation over procedures.
    const estatusQb = this.db
      .select({ estatus: procedures.estatus, total: count() })
      .from(procedures)
      .innerJoin(purchasingUnits, eq(purchasingUnits.id, procedures.purchasingUnitId))
      .innerJoin(institutions, eq(institutions.id, purchasingUnits.institutionId))
      .groupBy(procedures.estatus)
      .orderBy(desc(count()));
    if (conditions.length) estatusQb.where(and(...conditions));
    const estatusRows = await estatusQb;

    return {
      total_monto: totalMonto,
      total_procedimientos: totalProcedimientos,
      total_contratos: totalContratos,
      monto_promedio: totalContratos === 0 ? 0 : totalMonto / totalContratos,
      distribucion_montos: {
        menor_100k: Number(row[0]?.bucket_lt_100k ?? 0),
        entre_100k_1m: Number(row[0]?.bucket_100k_1m ?? 0),
        entre_1m_10m: Number(row[0]?.bucket_1m_10m ?? 0),
        mayor_10m: Number(row[0]?.bucket_gt_10m ?? 0),
      },
      por_estatus: estatusRows.map((e) => ({
        estatus: e.estatus,
        total: Number(e.total),
      })),
    };
  }

  async byInstitucion(params: AnalyticsParams): Promise<InstitucionGroup[]> {
    const conditions = this.buildConditions(params);
    const qb = this.db
      .select({
        clave: institutions.claveInstitucion,
        nombre: institutions.nombreInstitucion,
        siglas: institutions.siglas,
        total_monto: sql<string>`coalesce(sum(${contracts.importeDrc}), 0)`.as('total_monto'),
        total_procedimientos: countDistinct(procedures.id),
        total_contratos: count(contracts.id),
      })
      .from(procedures)
      .innerJoin(purchasingUnits, eq(purchasingUnits.id, procedures.purchasingUnitId))
      .innerJoin(institutions, eq(institutions.id, purchasingUnits.institutionId))
      .leftJoin(contracts, eq(contracts.procedureId, procedures.id))
      .groupBy(
        institutions.id,
        institutions.claveInstitucion,
        institutions.nombreInstitucion,
        institutions.siglas,
      )
      .orderBy(desc(sql`total_monto`))
      .limit(params.limit);
    if (conditions.length) qb.where(and(...conditions));
    const rows = await qb;
    return rows.map((r) => ({
      clave: r.clave,
      nombre: r.nombre,
      siglas: r.siglas,
      total_monto: toNum(r.total_monto),
      total_procedimientos: Number(r.total_procedimientos ?? 0),
      total_contratos: Number(r.total_contratos ?? 0),
    }));
  }

  async byTipoContratacion(
    filters: ProcedureFilter,
  ): Promise<{ por_tipo_contratacion: TipoGroup[]; por_tipo_procedimiento: TipoGroup[] }> {
    const conditions = this.buildConditions(filters);
    const [byContratacion, byProcedimiento] = await Promise.all([
      this.groupByDimension(conditions, procedures.tipoContratacion),
      this.groupByDimension(conditions, procedures.tipoProcedimiento),
    ]);
    return { por_tipo_contratacion: byContratacion, por_tipo_procedimiento: byProcedimiento };
  }

  /** Shared GROUP BY dimension for the two tipo breakdowns (CA-2). */
  private async groupByDimension(
    conditions: SQL[],
    column: PgColumn,
  ): Promise<TipoGroup[]> {
    const qb = this.db
      .select({
        clave: column,
        total_monto: sql<string>`coalesce(sum(${contracts.importeDrc}), 0)`.as('total_monto'),
        total_procedimientos: countDistinct(procedures.id),
        total_contratos: count(contracts.id),
      })
      .from(procedures)
      .innerJoin(purchasingUnits, eq(purchasingUnits.id, procedures.purchasingUnitId))
      .innerJoin(institutions, eq(institutions.id, purchasingUnits.institutionId))
      .leftJoin(contracts, eq(contracts.procedureId, procedures.id))
      .groupBy(column)
      .orderBy(desc(sql`total_monto`));
    if (conditions.length) qb.where(and(...conditions));
    const rows = await qb;
    return rows.map((r) => ({
      clave: r.clave as string | null,
      total_monto: toNum(r.total_monto),
      total_procedimientos: Number(r.total_procedimientos ?? 0),
      total_contratos: Number(r.total_contratos ?? 0),
    }));
  }

  async topProveedores(params: AnalyticsParams): Promise<SupplierGroup[]> {
    const conditions = this.buildConditions(params);
    const qb = this.db
      .select({
        rfc: suppliers.rfc,
        nombre: suppliers.nombre,
        total_monto: sql<string>`coalesce(sum(${contracts.importeDrc}), 0)`.as('total_monto'),
        total_contratos: count(contracts.id),
      })
      .from(contracts)
      .innerJoin(procedures, eq(procedures.id, contracts.procedureId))
      .innerJoin(purchasingUnits, eq(purchasingUnits.id, procedures.purchasingUnitId))
      .innerJoin(institutions, eq(institutions.id, purchasingUnits.institutionId))
      .innerJoin(suppliers, eq(suppliers.id, contracts.supplierId))
      .groupBy(suppliers.id, suppliers.rfc, suppliers.nombre)
      .orderBy(desc(sql`total_monto`))
      .limit(params.limit);
    if (conditions.length) qb.where(and(...conditions));
    const rows = await qb;
    return rows.map((r) => ({
      rfc: r.rfc,
      nombre: r.nombre,
      total_monto: toNum(r.total_monto),
      total_contratos: Number(r.total_contratos ?? 0),
    }));
  }

  // ───────────────────────────────────────────── shared filter builder (CA-6)

  /**
   * Build the WHERE conditions shared by every query. Returns an array (empty
   * when no filters) so callers can decide whether to apply `.where()` at all.
   *
   * All conditions reference tables joined by every public method
   * (`procedures`, `purchasing_units`, `institutions`), plus `inArray`
   * subqueries for contract-linked dimensions (`monto`, `proveedor`).
   */
  private buildConditions(f: ProcedureFilter): SQL[] {
    const conds: SQL[] = [];

    if (f.tipo_contratacion) conds.push(eq(procedures.tipoContratacion, f.tipo_contratacion));
    if (f.tipo_procedimiento)
      conds.push(eq(procedures.tipoProcedimiento, f.tipo_procedimiento));
    if (f.ley) conds.push(eq(procedures.ley, f.ley));
    if (f.estatus) conds.push(eq(procedures.estatus, f.estatus));

    if (f.institucion) {
      const t = `%${f.institucion}%`;
      conds.push(
        or(ilike(institutions.nombreInstitucion, t), ilike(institutions.claveInstitucion, t))!,
      );
    }

    if (f.q) conds.push(ilike(procedures.descripcion, `%${f.q}%`));

    // Date range: procedure matches when fecha_publicacion OR fecha_apertura
    // falls fully within [desde, hasta] (each bound optional).
    const desde = parseDate(f.fecha_desde);
    const hasta = parseDate(f.fecha_hasta);
    if (desde || hasta) {
      const pub: SQL[] = [];
      const ap: SQL[] = [];
      if (desde) {
        pub.push(gte(procedures.fechaPublicacion, desde));
        ap.push(gte(procedures.fechaApertura, desde));
      }
      if (hasta) {
        pub.push(lte(procedures.fechaPublicacion, hasta));
        ap.push(lte(procedures.fechaApertura, hasta));
      }
      conds.push(or(and(...pub), and(...ap))!);
    }

    // Amount range: procedure has ≥1 contract with importe_drc in [min,max].
    // `importe_drc` is numeric (string-typed in TS), so compare via raw SQL.
    if (f.monto_min != null || f.monto_max != null) {
      const amt: SQL[] = [];
      if (f.monto_min != null)
        amt.push(sql`${contracts.importeDrc} >= ${f.monto_min}`);
      if (f.monto_max != null)
        amt.push(sql`${contracts.importeDrc} <= ${f.monto_max}`);
      conds.push(
        inArray(
          procedures.id,
          this.db
            .select({ id: contracts.procedureId })
            .from(contracts)
            .where(and(...amt)),
        ),
      );
    }

    // Supplier filter: rfc OR nombre contains the term.
    if (f.proveedor) {
      const t = `%${f.proveedor}%`;
      conds.push(
        inArray(
          procedures.id,
          this.db
            .select({ id: contracts.procedureId })
            .from(contracts)
            .innerJoin(suppliers, eq(suppliers.id, contracts.supplierId))
            .where(or(ilike(suppliers.rfc, t), ilike(suppliers.nombre, t))),
        ),
      );
    }

    return conds;
  }
}

/** Convert a numeric(18,2) result (string | null) to a JS number. */
function toNum(v: unknown): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Parse an ISO date string into a Date, returning null if invalid/empty. */
function parseDate(s: string | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
