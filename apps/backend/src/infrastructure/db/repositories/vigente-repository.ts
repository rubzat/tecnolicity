import { and, eq, ilike, or, sql, asc, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../../db/schema/index.js';
import { vigenteProcedures } from '../../../db/schema/index.js';
import { computePagination } from '../../../application/queries/pagination.js';
import type {
  VigenteRepository,
  VigenteRecord,
  UpsertVigenteInput,
  VigenteFilter,
  VigentePage,
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
    const like = `%${f.q}%`;
    conds.push(
      or(
        ilike(vigenteProcedures.numeroProcedimiento, like),
        ilike(vigenteProcedures.nombre, like),
      )!,
    );
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

  async list(filter: VigenteFilter, page: number, pageSize: number): Promise<VigentePage> {
    const where = buildFilter(filter);

    const totalRow = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(vigenteProcedures)
      .where(where ?? sql`true`);
    const total = totalRow[0]?.total ?? 0;

    const { offset, limit, meta } = computePagination(page, pageSize, total);

    const rows = await this.db
      .select()
      .from(vigenteProcedures)
      .where(where ?? sql`true`)
      // Most urgent deadlines first. Procedures with no deadline sink to the
      // bottom (NULLS LAST) so they never jump ahead of real, expiring bids.
      .orderBy(
        asc(vigenteProcedures.fechaPresentacionApertura),
        asc(vigenteProcedures.numeroProcedimiento),
      )
      .limit(limit)
      .offset(offset);

    // Postgres NULLS is the default LAST for ASC, but be explicit-safe: any row
    // whose deadline is null already sorts after non-null by ASC ordering, so
    // no extra expression is needed here.
    return { data: rows.map(toRecord), pagination: meta };
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
}
