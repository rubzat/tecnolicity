import { COLUMNS, DATE_FORMATS } from '../../infrastructure/csv/columns.js';
import { normalizeTimestamp, normalizeDateOnly } from '../../infrastructure/csv/date-normalizer.js';
import { nullableString, parseMoney, parseBoolean } from '../../infrastructure/csv/primitives.js';
import type {
  MappedRow,
  MappedInstitution,
  MappedPurchasingUnit,
  MappedSupplier,
  MappedProcedure,
  MappedExpediente,
  MappedContract,
  MappedAmount,
} from './types.js';

/** Default currency when the amount block has values but Moneda is blank. */
const DEFAULT_MONEDA = 'MXN';

/**
 * Thrown when a row cannot be mapped to valid entities (typically a missing
 * natural key). The orchestrator catches this and routes the row to quarantine
 * (CI-7) — ingestion continues.
 */
export class RowMapError extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = 'RowMapError';
  }
}

function field(row: string[], idx: number): string {
  return row[idx] ?? '';
}

/**
 * Map a single parsed CSV row (positional, per columns.COLUMNS) into the
 * 8-entity shape. Natural keys are validated here; everything else degrades
 * gracefully to null.
 *
 * @throws {RowMapError} if a required natural key is missing.
 */
export function mapRow(row: string[]): MappedRow {
  if (!Array.isArray(row) || row.length < COLUMNS.direccionAnuncio + 1) {
    throw new RowMapError(
      `row has ${row?.length ?? 0} columns, expected ${COLUMNS.direccionAnuncio + 1}`,
      'structure',
    );
  }

  // --- Required natural keys (quarantine if absent) ---
  const claveInstitucion = nullableString(field(row, COLUMNS.claveInstitucion));
  if (!claveInstitucion) throw new RowMapError('missing clave_institucion', 'clave_institucion');

  const claveUc = nullableString(field(row, COLUMNS.claveUc));
  if (!claveUc) throw new RowMapError('missing clave_uc', 'clave_uc');

  const numeroProcedimiento = nullableString(field(row, COLUMNS.numeroProcedimiento));
  if (!numeroProcedimiento)
    throw new RowMapError('missing numero_procedimiento', 'numero_procedimiento');

  // --- Institution ---
  const institution: MappedInstitution = {
    claveInstitucion,
    nombreInstitucion:
      nullableString(field(row, COLUMNS.nombreInstitucion)) ?? claveInstitucion,
    siglas: nullableString(field(row, COLUMNS.siglasInstitucion)),
    ordenGobierno: nullableString(field(row, COLUMNS.ordenGobierno)),
    claveRamo: nullableString(field(row, COLUMNS.claveRamo)),
    descripcionRamo: nullableString(field(row, COLUMNS.descripcionRamo)),
    tipoInstitucion: nullableString(field(row, COLUMNS.tipoInstitucion)),
  };

  // --- Purchasing unit ---
  const purchasingUnit: MappedPurchasingUnit = {
    claveUc,
    nombreUc: nullableString(field(row, COLUMNS.nombreUc)) ?? claveUc,
    claveInstitucion,
  };

  // --- Supplier (nullable: contract may have no RFC) ---
  const rfc = nullableString(field(row, COLUMNS.rfc));
  const supplier: MappedSupplier | null = rfc
    ? {
        rfc,
        nombre: nullableString(field(row, COLUMNS.proveedor)) ?? rfc,
        folioRupc: nullableString(field(row, COLUMNS.folioRupc)),
        pais: nullableString(field(row, COLUMNS.pais)),
        nacionalidad: nullableString(field(row, COLUMNS.nacionalidad)),
        estratificacion: nullableString(field(row, COLUMNS.estratificacion)),
        autoRegistroCompranet: nullableString(field(row, COLUMNS.autoRegistroCompranet)),
      }
    : null;

  // --- Procedure ---
  const tituloExpediente = nullableString(field(row, COLUMNS.tituloExpediente));
  const procedure: MappedProcedure = {
    numeroProcedimiento,
    claveUc,
    caracter: nullableString(field(row, COLUMNS.caracterProcedimiento)),
    tipoContratacion: nullableString(field(row, COLUMNS.tipoContratacion)),
    tipoProcedimiento: nullableString(field(row, COLUMNS.tipoProcedimiento)),
    ley: nullableString(field(row, COLUMNS.ley)),
    articuloExcepcion: nullableString(field(row, COLUMNS.articuloExcepcion)),
    descripcionExcepcion: nullableString(field(row, COLUMNS.descripcionExcepcion)),
    contratoMarco: parseBoolean(field(row, COLUMNS.contratoMarco)),
    compraConsolidada: parseBoolean(field(row, COLUMNS.compraConsolidada)),
    formaParticipacion: nullableString(field(row, COLUMNS.formaParticipacion)),
    casoFortuito: nullableString(field(row, COLUMNS.casoFortuito)),
    creditoExterno: parseBoolean(field(row, COLUMNS.creditoExterno)),
    estatus: nullableString(field(row, COLUMNS.estatusDrc)),
    fechaPublicacion: normalizeTimestamp(field(row, COLUMNS.fechaPublicacion), DATE_FORMATS.fechaPublicacion),
    fechaApertura: normalizeTimestamp(field(row, COLUMNS.fechaApertura), DATE_FORMATS.fechaApertura),
    fechaFallo: normalizeTimestamp(field(row, COLUMNS.fechaFallo), DATE_FORMATS.fechaFallo),
    direccionAnuncio: nullableString(field(row, COLUMNS.direccionAnuncio)),
    // Best descriptive proxy for a procedure (no dedicated descripcion column
    // in the source): the expediente título. Used later for full-text search.
    descripcion: tituloExpediente,
  };

  // --- Expediente ---
  const expediente: MappedExpediente = {
    codigoExpediente: nullableString(field(row, COLUMNS.codigoExpediente)),
    referencia: nullableString(field(row, COLUMNS.referenciaExpediente)),
    titulo: tituloExpediente,
    partidaEspecifica: nullableString(field(row, COLUMNS.partidaEspecifica)),
  };

  // --- Contract ---
  const monedaOriginal = nullableString(field(row, COLUMNS.monedaOriginal)) ?? DEFAULT_MONEDA;
  const contract: MappedContract = {
    codigoContrato: nullableString(field(row, COLUMNS.codigoContrato)),
    numeroContrato: nullableString(field(row, COLUMNS.numeroContrato)),
    titulo: nullableString(field(row, COLUMNS.tituloContrato)),
    descripcion: nullableString(field(row, COLUMNS.descripcionContrato)),
    contratoPlurianual: parseBoolean(field(row, COLUMNS.contratoPlurianual)),
    estatusDrc: nullableString(field(row, COLUMNS.estatusDrc)),
    fechaInicio: normalizeDateOnly(field(row, COLUMNS.fechaInicio), DATE_FORMATS.fechaInicio),
    fechaFin: normalizeDateOnly(field(row, COLUMNS.fechaFin), DATE_FORMATS.fechaFin),
    fechaFirma: normalizeDateOnly(field(row, COLUMNS.fechaFirma), DATE_FORMATS.fechaFirma),
    fechaFirmaContrato: normalizeDateOnly(
      field(row, COLUMNS.fechaFirmaContrato),
      DATE_FORMATS.fechaFirmaContrato,
    ),
    importeDrc: parseMoney(field(row, COLUMNS.importeDrc)),
    moneda: monedaOriginal,
    convenioModificatorio: parseBoolean(
      field(row, COLUMNS.convenioModificatorioOriginal),
    ),
    codigoRefContrato: nullableString(field(row, COLUMNS.codigoRefContrato)),
    estatusContrato: nullableString(field(row, COLUMNS.estatusContrato)),
    tipoContrato: nullableString(field(row, COLUMNS.tipoContrato)),
    rfc,
  };

  // --- Amounts: ORIGINAL block (cols 51–54) + CONVENIO block (cols 59–62) ---
  const amounts = mapAmounts(row);

  return { institution, purchasingUnit, supplier, procedure, expediente, contract, amounts };
}

/** Build the original + convenio amount rows; null when the block is empty. */
function mapAmounts(row: string[]): {
  original: MappedAmount | null;
  convenio: MappedAmount | null;
} {
  const original = buildAmount(
    row,
    'original',
    COLUMNS.montoSinImpMinOriginal,
    COLUMNS.montoConImpMinOriginal,
    COLUMNS.montoSinImpMaxOriginal,
    COLUMNS.montoConImpMaxOriginal,
    COLUMNS.monedaOriginal,
    COLUMNS.codigoRefContrato,
    null, // original has no convenio end-date
  );

  const convenio = buildAmount(
    row,
    'convenio',
    COLUMNS.montoSinImpMinConvenio,
    COLUMNS.montoConImpMinConvenio,
    COLUMNS.montoSinImpMaxConvenio,
    COLUMNS.montoConImpMaxConvenio,
    COLUMNS.monedaConvenio,
    COLUMNS.codigoRefUltimoConvenio,
    COLUMNS.fechaFinUltimoConv,
  );

  return { original, convenio };
}

function buildAmount(
  row: string[],
  tipo: AmountTipoSafe,
  sinMinIdx: number,
  conMinIdx: number,
  sinMaxIdx: number,
  conMaxIdx: number,
  monedaIdx: number,
  codigoRefIdx: number,
  fechaFinIdx: number | null,
): MappedAmount | null {
  const montoSinImpMin = parseMoney(field(row, sinMinIdx));
  const montoConImpMin = parseMoney(field(row, conMinIdx));
  const montoSinImpMax = parseMoney(field(row, sinMaxIdx));
  const montoConImpMax = parseMoney(field(row, conMaxIdx));
  const codigoRef = nullableString(field(row, codigoRefIdx));
  const fechaFinConvenio =
    fechaFinIdx != null
      ? normalizeDateOnly(field(row, fechaFinIdx), 'iso')
      : null;

  // Skip the row entirely when the block is empty (sparse amounts — CI-4).
  const hasAny =
    montoSinImpMin != null ||
    montoConImpMin != null ||
    montoSinImpMax != null ||
    montoConImpMax != null ||
    codigoRef != null ||
    fechaFinConvenio != null;
  if (!hasAny) return null;

  const moneda = nullableString(field(row, monedaIdx)) ?? DEFAULT_MONEDA;

  return {
    tipo,
    montoSinImpMin,
    montoConImpMin,
    montoSinImpMax,
    montoConImpMax,
    moneda,
    codigoRef,
    fechaFinConvenio,
  };
}

type AmountTipoSafe = 'original' | 'convenio';
