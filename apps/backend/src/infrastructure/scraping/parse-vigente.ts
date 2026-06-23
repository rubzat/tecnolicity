/**
 * Pure parsing helpers for the ComprasMX vigente search response (PR7).
 *
 * Split out of the Playwright scraper so the fragile "map an API registro →
 * our domain row" logic is unit-testable against captured fixtures without
 * launching a browser (same split rationale as extract-anexos.ts).
 *
 * Verified API contract (discovery #231):
 *   POST whitney/sitiopublico/expedientes?rows=&page=
 *   body: { id_estatus:0, id_proceso:0, ... }  ← 0 = "Anuncios vigentes"
 *   resp: { success, data:[{ registros:[...], paginacion:[{total_registros,
 *          total_paginas, pagina_actual, registros_pagina}] }] }
 */

import type { UpsertVigenteInput } from '../../domain/repositories/vigente-repository.js';

/** Base URL of the ComprasMX public SPA (for building detail links). */
export const COMPRASMX_SPA =
  'https://comprasmx.buengobierno.gob.mx/sitiopublico/#/sitiopublico/detalle/';

/** The "Anuncios vigentes" filter body (id_estatus:0, id_proceso:0). */
export const VIGENTE_FILTER_BODY = {
  id_ley: null,
  id_tipo_procedimiento: null,
  id_tipo_contratacion: null,
  fecha_apertura_inicio: null,
  fecha_apertura_fin: null,
  fecha_publicacion_inicio: null,
  fecha_publicacion_fin: null,
  id_tipo_dependencia: [],
  numero_procedimiento: null,
  nombre_procedimiento: null,
  credito_externo: null,
  exclusivo_mipymes: null,
  id_forma_participacion: null,
  id_entidad_federativa: [],
  id_p_especifica: [],
  id_caracter_procedimiento: null,
  id_estatus: 0,
  id_proceso: 0,
  codigo_expediente: null,
  codigo_procedimiento: null,
  estatus_alterno: [],
  compra_consolidada: false,
} as const;

/** Pagination metadata parsed from `data[0].paginacion[0]`. */
export interface VigentePagination {
  totalRegistros: number;
  totalPaginas: number;
  paginaActual: number;
  registrosPagina: number;
}

/** Result of parsing one search response page. */
export interface ParsedVigentePage {
  registros: UpsertVigenteInput[];
  pagination: VigentePagination | null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function str(rec: Record<string, unknown>, key: string): string | null {
  const v = rec[key];
  if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  if (typeof v === 'number') return String(v);
  return null;
}

/**
 * Parse an ISO-ish datetime string from the API ("2026-06-23T17:40:00").
 *
 * The API returns Mexico-City LOCAL times WITHOUT a zone offset. If we naively
 * `new Date(...)` them, Node interprets them in the SERVER's local zone — so the
 * stored instant would silently drift with wherever the process runs. To make
 * the instant deterministic and correct we append Mexico City's fixed offset
 * (UTC-6 year-round since Mexico abolished DST in 2022) when the string carries
 * no offset of its own. Returns null for empty/garbage values.
 */
const MX_OFFSET = '-06:00';
function parseDate(v: unknown): Date | null {
  if (typeof v !== 'string' || v.trim() === '') return null;
  let s = v.trim();
  // Has an explicit offset (Z or ±hh:mm)? Use it as-is. Otherwise pin to MX.
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(s);
  if (!hasZone) s = `${s}${MX_OFFSET}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Build the detail/anuncio URL from a procedure's SPA uuid. */
export function buildAnuncioUrl(uuid: string | null): string | null {
  if (!uuid) return null;
  return `${COMPRASMX_SPA}${uuid}/procedimiento`;
}

/**
 * Turn ONE raw API registro into a normalized upsert input.
 * Returns null when the registro has no numero_procedimiento (unusable).
 *
 * Field map (API → DB) — see discovery #231:
 *   numero_procedimiento       → numeroProcedimiento
 *   nombre_procedimiento       → nombre
 *   caracter                   → caracter
 *   siglas                     → siglasDependencia   (no full name in API)
 *   estatus                    → estatus             ("VIGENTE PAP")
 *   fecha_aclaraciones         → fechaJuntaAclaraciones
 *   fecha_apertura             → fechaPresentacionApertura  (bid deadline)
 *   tipo_procedimiento         → tipoProcedimiento
 *   tipo_contratacion          → tipoContratacion
 *   unidad_compradora          → unidadCompradora    ("CLAVE - NOMBRE")
 *   cod_expediente             → codigoExpediente
 *   uuid_procedimiento         → uuidProcedimiento   (→ direcciones_anuncio)
 *   entidad_federativa_contratacion → entidadFederativa
 */
export function parseRegistro(raw: unknown): UpsertVigenteInput | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  const numero = str(rec, 'numero_procedimiento');
  if (!numero) return null;
  const uuid = str(rec, 'uuid_procedimiento');
  return {
    numeroProcedimiento: numero,
    nombre: str(rec, 'nombre_procedimiento'),
    caracter: str(rec, 'caracter'),
    dependencia: null, // NOT provided by the search API (only siglas).
    siglasDependencia: str(rec, 'siglas'),
    estatus: str(rec, 'estatus'),
    fechaJuntaAclaraciones: parseDate(rec['fecha_aclaraciones']),
    fechaPresentacionApertura: parseDate(rec['fecha_apertura']),
    tipoProcedimiento: str(rec, 'tipo_procedimiento'),
    tipoContratacion: str(rec, 'tipo_contratacion'),
    unidadCompradora: str(rec, 'unidad_compradora'),
    codigoExpediente: str(rec, 'cod_expediente') ?? str(rec, 'codigo_expediente'),
    uuidProcedimiento: uuid,
    direccionesAnuncio: buildAnuncioUrl(uuid),
    entidadFederativa: str(rec, 'entidad_federativa_contratacion'),
    rawData: rec,
  };
}

/**
 * Parse a full search response body into registros + pagination.
 * Defensive: tolerates missing `data`, missing `paginacion`, non-array shapes.
 */
export function parseSearchResponse(body: unknown): ParsedVigentePage {
  const root = asRecord(body);
  if (!root) return { registros: [], pagination: null };
  const data = root['data'];
  const wrapper = Array.isArray(data) ? asRecord(data[0]) : asRecord(data);
  if (!wrapper) return { registros: [], pagination: null };

  const rawRegistros = wrapper['registros'];
  const registros: UpsertVigenteInput[] = Array.isArray(rawRegistros)
    ? rawRegistros.map(parseRegistro).filter((r): r is UpsertVigenteInput => r !== null)
    : [];

  let pagination: VigentePagination | null = null;
  const rawPag = wrapper['paginacion'];
  const pagRec = Array.isArray(rawPag) ? asRecord(rawPag[0]) : asRecord(rawPag);
  if (pagRec) {
    const totalRegistros = Number(pagRec['total_registros'] ?? 0);
    const totalPaginas = Number(pagRec['total_paginas'] ?? 0);
    if (Number.isFinite(totalRegistros)) {
      pagination = {
        totalRegistros,
        totalPaginas,
        paginaActual: Number(pagRec['pagina_actual'] ?? 0),
        registrosPagina: Number(pagRec['registros_pagina'] ?? 0),
      };
    }
  }

  return { registros, pagination };
}
