import { and, eq, ilike, or, sql, asc, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../../db/schema/index.js';
import { vigenteProcedures, opportunitySegmentStats } from '../../../db/schema/index.js';
import { computePagination } from '../../../application/queries/pagination.js';
import type {
  VigenteRepository,
  VigenteRecord,
  UpsertVigenteInput,
  VigenteFilter,
  VigentePage,
  VigenteDetalleCache,
} from '../../../domain/repositories/vigente-repository.js';

type Db = NodePgDatabase<typeof schema>;

function toRecord(row: typeof vigenteProcedures.$inferSelect): VigenteRecord {
  return {
    id: row.id,
    numeroProcedimiento: row.numeroProcedimiento,
    nombre: row.nombre,
    caracter: row.caracter,
    dependencia: row.dependencia,
    siglasDependencia: row.siglasDependencia,
    estatus: row.estatus,
    fechaJuntaAclaraciones: row.fechaJuntaAclaraciones,
    fechaPresentacionApertura: row.fechaPresentacionApertura,
    tipoProcedimiento: row.tipoProcedimiento,
    tipoContratacion: row.tipoContratacion,
    unidadCompradora: row.unidadCompradora,
    codigoExpediente: row.codigoExpediente,
    uuidProcedimiento: row.uuidProcedimiento,
    direccionesAnuncio: row.direccionesAnuncio,
    entidadFederativa: row.entidadFederativa,
    scrapedAt: row.scrapedAt,
    createdAt: row.createdAt,
    score: null,
    scoreBreakdown: null,
  };
}

/** Build the filter WHERE clause. `q` is a substring over numero + nombre. */
function buildFilter(f: VigenteFilter) {
  const conds = [];
  if (f.tipoContratacion) conds.push(eq(vigenteProcedures.tipoContratacion, f.tipoContratacion));
  if (f.tipoProcedimiento)
    conds.push(eq(vigenteProcedures.tipoProcedimiento, f.tipoProcedimiento));
  if (f.siglas) conds.push(eq(vigenteProcedures.siglasDependencia, f.siglas));
  if (f.entidadFederativa)
    conds.push(eq(vigenteProcedures.entidadFederativa, f.entidadFederativa));
  // `dependencia` is nullable (the API never sends it); accept siglas as a
  // best-effort match too so the filter is useful with real data.
  if (f.dependencia) {
    conds.push(
      or(
        ilike(vigenteProcedures.dependencia, `%${f.dependencia}%`),
        ilike(vigenteProcedures.siglasDependencia, `%${f.dependencia}%`),
      )!,
    );
  }
  if (f.q) {
    // Support comma-separated keywords: "software,camara,CCTV" → OR match.
    const keywords = f.q
      .split(',')
      .map((k) => k.trim())
      .filter((k) => k.length > 0);
    if (keywords.length > 0) {
      const keywordConds = keywords.flatMap((kw) => {
        const like = `%${kw}%`;
        return [
          ilike(vigenteProcedures.numeroProcedimiento, like),
          ilike(vigenteProcedures.nombre, like),
        ];
      });
      conds.push(or(...keywordConds)!);
    }
  }
  return conds.length === 0 ? undefined : and(...conds);
}

/**
 * Drizzle implementation of {@link VigenteRepository}.
 *
 * The table is small (≈1–2k vigente rows at any time) so filtered reads use
 * plain btree/ILIKE — no tsvector/GIN machinery is warranted here (contrast
 * with the 312K-row historical `procedures` table in PR6).
 */
export class DrizzleVigenteRepository implements VigenteRepository {
  constructor(private readonly db: Db) {}

  async upsertMany(
    rows: UpsertVigenteInput[],
  ): Promise<{ inserted: number; updated: number }> {
    if (rows.length === 0) return { inserted: 0, updated: 0 };

    // Count how many already exist so we can report inserted vs updated
    // accurately (cheap on a ~1k-row table).
    const numeros = rows.map((r) => r.numeroProcedimiento);
    const existing = await this.db
      .select({ numero: vigenteProcedures.numeroProcedimiento })
      .from(vigenteProcedures)
      .where(inArray(vigenteProcedures.numeroProcedimiento, numeros));
    const preExisting = new Set(existing.map((r) => r.numero));

    // Chunk to keep VALUES tuples bounded (mirrors upsert-repositories.ts).
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const batch = rows.slice(i, i + CHUNK);
      await this.db
        .insert(vigenteProcedures)
        .values(
          batch.map((r) => ({
            numeroProcedimiento: r.numeroProcedimiento,
            nombre: r.nombre,
            caracter: r.caracter,
            dependencia: r.dependencia,
            siglasDependencia: r.siglasDependencia,
            estatus: r.estatus,
            fechaJuntaAclaraciones: r.fechaJuntaAclaraciones,
            fechaPresentacionApertura: r.fechaPresentacionApertura,
            tipoProcedimiento: r.tipoProcedimiento,
            tipoContratacion: r.tipoContratacion,
            unidadCompradora: r.unidadCompradora,
            codigoExpediente: r.codigoExpediente,
            uuidProcedimiento: r.uuidProcedimiento,
            direccionesAnuncio: r.direccionesAnuncio,
            entidadFederativa: r.entidadFederativa,
            rawData: r.rawData,
            // Refresh the snapshot timestamp on every re-scrape.
            scrapedAt: new Date(),
          })),
        )
        .onConflictDoUpdate({
          target: vigenteProcedures.numeroProcedimiento,
          set: {
            nombre: sql`excluded.nombre`,
            caracter: sql`excluded.caracter`,
            dependencia: sql`excluded.dependencia`,
            siglasDependencia: sql`excluded.siglas_dependencia`,
            estatus: sql`excluded.estatus`,
            fechaJuntaAclaraciones: sql`excluded.fecha_junta_aclaraciones`,
            fechaPresentacionApertura: sql`excluded.fecha_presentacion_apertura`,
            tipoProcedimiento: sql`excluded.tipo_procedimiento`,
            tipoContratacion: sql`excluded.tipo_contratacion`,
            unidadCompradora: sql`excluded.unidad_compradora`,
            codigoExpediente: sql`excluded.codigo_expediente`,
            uuidProcedimiento: sql`excluded.uuid_procedimiento`,
            direccionesAnuncio: sql`excluded.direcciones_anuncio`,
            entidadFederativa: sql`excluded.entidad_federativa`,
            rawData: sql`excluded.raw_data`,
            scrapedAt: sql`excluded.scraped_at`,
          },
        });
    }

    const updated = rows.filter((r) => preExisting.has(r.numeroProcedimiento)).length;
    return { inserted: rows.length - updated, updated };
  }

  async list(
    filter: VigenteFilter,
    page: number,
    pageSize: number,
    sort: 'urgency' | 'score' = 'urgency',
  ): Promise<VigentePage> {
    const where = buildFilter(filter);

    const totalRow = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(vigenteProcedures)
      .where(where ?? sql`true`);
    const total = totalRow[0]?.total ?? 0;

    const { offset, limit, meta } = computePagination(page, pageSize, total);

    // Postgres pone los NULL primero en DESC por default — hay que forzarlo
    // explícito para que las vigentes sin score no salgan arriba de las que sí tienen.
    // Ambas ramas cierran con `numero_procedimiento` (único) como desempate
    // final: sin él, las filas empatadas en todas las llaves previas pueden
    // reordenarse entre requests y LIMIT/OFFSET repetiría o saltaría filas.
    const orderBy =
      sort === 'score'
        ? [
            sql`${opportunitySegmentStats.score} DESC NULLS LAST`,
            asc(vigenteProcedures.fechaPresentacionApertura),
            asc(vigenteProcedures.numeroProcedimiento),
          ]
        : [asc(vigenteProcedures.fechaPresentacionApertura), asc(vigenteProcedures.numeroProcedimiento)];

    const rows = await this.db
      .select({
        vigente: vigenteProcedures,
        amountScore: opportunitySegmentStats.amountScore,
        competitionScore: opportunitySegmentStats.competitionScore,
        isDominated: opportunitySegmentStats.isDominated,
        sampleSize: opportunitySegmentStats.sampleSize,
        score: opportunitySegmentStats.score,
      })
      .from(vigenteProcedures)
      .leftJoin(
        opportunitySegmentStats,
        and(
          eq(opportunitySegmentStats.tipoContratacion, vigenteProcedures.tipoContratacion),
          eq(opportunitySegmentStats.siglasDependencia, vigenteProcedures.siglasDependencia),
        ),
      )
      .where(where ?? sql`true`)
      .orderBy(...orderBy)
      .limit(limit)
      .offset(offset);

    const data = rows.map((r) => {
      const base = toRecord(r.vigente);
      if (r.score == null) return base;
      return {
        ...base,
        score: r.score,
        scoreBreakdown: {
          amountScore: r.amountScore!,
          competitionScore: r.competitionScore!,
          isDominated: r.isDominated!,
          sampleSize: r.sampleSize!,
        },
      };
    });

    return { data, pagination: meta };
  }

  async getByNumero(numeroProcedimiento: string): Promise<VigenteRecord | null> {
    const rows = await this.db
      .select()
      .from(vigenteProcedures)
      .where(eq(vigenteProcedures.numeroProcedimiento, numeroProcedimiento))
      .limit(1);
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async count(): Promise<number> {
    const rows = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(vigenteProcedures);
    return rows[0]?.total ?? 0;
  }

  async getDetalle(numeroProcedimiento: string): Promise<VigenteDetalleCache | null> {
    const rows = await this.db
      .select({
        detalleJson: vigenteProcedures.detalleJson,
        anexosJson: vigenteProcedures.anexosJson,
        reqeconomicosJson: vigenteProcedures.reqeconomicosJson,
        detalleFetchedAt: vigenteProcedures.detalleFetchedAt,
      })
      .from(vigenteProcedures)
      .where(eq(vigenteProcedures.numeroProcedimiento, numeroProcedimiento))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      detalleJson: row.detalleJson,
      anexosJson: row.anexosJson,
      reqeconomicosJson: row.reqeconomicosJson,
      detalleFetchedAt: row.detalleFetchedAt,
    };
  }

  async updateDetalle(
    numeroProcedimiento: string,
    detalle: unknown | null,
    anexos: unknown | null,
    reqeconomicos: unknown | null,
  ): Promise<void> {
    await this.db
      .update(vigenteProcedures)
      .set({
        detalleJson: detalle as never,
        anexosJson: anexos as never,
        reqeconomicosJson: reqeconomicos as never,
        detalleFetchedAt: new Date(),
      })
      .where(eq(vigenteProcedures.numeroProcedimiento, numeroProcedimiento));
  }
}
