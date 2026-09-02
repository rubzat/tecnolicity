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
  /** Cuándo se vio esta vigente por primera vez (PR13: detecta "nueva"). */
  createdAt: Date;
  /** Score de oportunidad 0-100 (PR14), o null si el segmento no tiene datos históricos suficientes. */
  score: number | null;
  scoreBreakdown: VigenteScoreBreakdown | null;
}

export interface VigenteScoreBreakdown {
  amountScore: number;
  competitionScore: number;
  isDominated: boolean;
  sampleSize: number;
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

/**
 * Cached on-demand detail for a vigente procedure (PR8). Each field holds the
 * RAW JSON body intercepted from the ComprasMX detail API call (`null` when that
 * particular call did not fire or has not been fetched yet).
 */
export interface VigenteDetalleCache {
  detalleJson: unknown | null;
  anexosJson: unknown | null;
  reqeconomicosJson: unknown | null;
  detalleFetchedAt: Date | null;
}

export interface VigenteRepository {
  /** Upsert a batch by numero_procedimiento; returns how many rows changed. */
  upsertMany(rows: UpsertVigenteInput[]): Promise<{ inserted: number; updated: number }>;

  /** Filtrado + paginado. `sort` por defecto ordena por fecha límite (más urgente primero); 'score' ordena por score de oportunidad descendente. */
  list(filter: VigenteFilter, page: number, pageSize: number, sort?: 'urgency' | 'score'): Promise<VigentePage>;

  /** One procedure by its natural key, or null. */
  getByNumero(numeroProcedimiento: string): Promise<VigenteRecord | null>;

  /** Total row count (for the summary card). */
  count(): Promise<number>;

  /** Read the on-demand detail cache for a procedure (PR8). Null when unknown. */
  getDetalle(numeroProcedimiento: string): Promise<VigenteDetalleCache | null>;

  /** Persist an on-demand detail fetch into the jsonb cache + set fetched_at (PR8). */
  updateDetalle(
    numeroProcedimiento: string,
    detalle: unknown | null,
    anexos: unknown | null,
    reqeconomicos: unknown | null,
  ): Promise<void>;
}
