/**
 * VigenteRepository — domain port for the `vigente_procedures` table (PR7).
 *
 * The scraper writes its normalized snapshot here (upsert by
 * `numero_procedimiento`); the API reads filtered/paginated pages here.
 * Application use cases depend on THIS interface, never on Drizzle.
 */

/** A single currently-open procedure row (API wire shape is snake_case). */
export interface VigenteRecord {
  id: number;
  numeroProcedimiento: string;
  nombre: string | null;
  caracter: string | null;
  dependencia: string | null;
  siglasDependencia: string | null;
  estatus: string | null;
  fechaJuntaAclaraciones: Date | null;
  fechaPresentacionApertura: Date | null;
  tipoProcedimiento: string | null;
  tipoContratacion: string | null;
  unidadCompradora: string | null;
  codigoExpediente: string | null;
  uuidProcedimiento: string | null;
  direccionesAnuncio: string | null;
  entidadFederativa: string | null;
  scrapedAt: Date;
}

/** Input shape for an upsert (natural key = numero_procedimiento). */
export interface UpsertVigenteInput {
  numeroProcedimiento: string;
  nombre: string | null;
  caracter: string | null;
  dependencia: string | null;
  siglasDependencia: string | null;
  estatus: string | null;
  fechaJuntaAclaraciones: Date | null;
  fechaPresentacionApertura: Date | null;
  tipoProcedimiento: string | null;
  tipoContratacion: string | null;
  unidadCompradora: string | null;
  codigoExpediente: string | null;
  uuidProcedimiento: string | null;
  direccionesAnuncio: string | null;
  entidadFederativa: string | null;
  rawData: unknown;
}

/** Filter dimensions exposed by GET /api/vigentes. */
export interface VigenteFilter {
  tipoContratacion?: string;
  tipoProcedimiento?: string;
  dependencia?: string;
  siglas?: string;
  entidadFederativa?: string;
  /** Free-text search over numero + nombre. */
  q?: string;
}

/** A page of vigente procedures (list endpoint response payload). */
export interface VigentePage {
  data: VigenteRecord[];
  pagination: {
    page: number;
    page_size: number;
    total: number;
    total_pages: number;
  };
}

export interface VigenteRepository {
  /** Upsert a batch by numero_procedimiento; returns how many rows changed. */
  upsertMany(rows: UpsertVigenteInput[]): Promise<{ inserted: number; updated: number }>;

  /** Filtered + paginated list, sorted by bid deadline ascending (most urgent first). */
  list(filter: VigenteFilter, page: number, pageSize: number): Promise<VigentePage>;

  /** One procedure by its natural key, or null. */
  getByNumero(numeroProcedimiento: string): Promise<VigenteRecord | null>;

  /** Total row count (for the summary card). */
  count(): Promise<number>;
}
