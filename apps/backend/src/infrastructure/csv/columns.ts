/**
 * CSV column positions (0-indexed) for the ComprasMX 2026 contract export.
 *
 * The header has 73 columns and DUPLICATE names — notably two `Moneda` columns
 * (idx 45 = original, idx 55 = último convenio) and two `Convenio modificatorio`
 * columns (idx 46 = original, idx 56 = último convenio). We therefore address
 * columns strictly BY POSITION, never by header name.
 *
 * Source of truth: data/contratos_comprasmx_2026.csv (latin-1 encoded).
 * If the upstream header changes, re-derive these indices from the CSV header.
 */
export const COLUMNS = {
  // --- Institution (dedupe by clave_institucion) ---
  ordenGobierno: 0,
  claveRamo: 1,
  descripcionRamo: 2,
  tipoInstitucion: 3,
  claveInstitucion: 4,
  siglasInstitucion: 5,
  nombreInstitucion: 6,
  // --- Purchasing unit (dedupe by clave_uc, FK institution) ---
  claveUc: 7,
  nombreUc: 8,
  // --- Expediente (1 per row, FK procedure) ---
  codigoExpediente: 9,
  referenciaExpediente: 10,
  tituloExpediente: 11,
  partidaEspecifica: 12,
  // --- Procedure (dedupe by numero_procedimiento, FK purchasing_unit) ---
  ley: 13,
  tipoProcedimiento: 14,
  articuloExcepcion: 15,
  descripcionExcepcion: 16,
  contratoMarco: 17,
  compraConsolidada: 18,
  // 19..22 = consolidación fields (not modelled in schema)
  numeroProcedimiento: 23,
  tipoContratacion: 24,
  caracterProcedimiento: 25,
  formaParticipacion: 26,
  casoFortuito: 27,
  creditoExterno: 28,
  // 29..31 = organismo / programa / SHCP (not modelled)
  fechaPublicacion: 32, // ISO YYYY-MM-DD HH:mm:ss
  fechaApertura: 33, // ISO
  fechaFallo: 34, // ISO
  // --- Contract (1 per row, FK procedure + supplier) ---
  codigoContrato: 35,
  numeroContrato: 36,
  tituloContrato: 37,
  descripcionContrato: 38,
  contratoPlurianual: 39,
  estatusDrc: 40,
  fechaInicio: 41, // DD/MM/YYYY
  fechaFin: 42, // DD/MM/YYYY
  fechaFirma: 43, // ISO
  importeDrc: 44, // numeric, sparse
  monedaOriginal: 45,
  convenioModificatorioOriginal: 46,
  codigoRefContrato: 47,
  estatusContrato: 48,
  fechaFirmaContrato: 49, // ISO
  tipoContrato: 50,
  // --- Amounts: ORIGINAL block ---
  montoSinImpMinOriginal: 51,
  montoConImpMinOriginal: 52,
  montoSinImpMaxOriginal: 53,
  montoConImpMaxOriginal: 54,
  // --- Amounts: ÚLTIMO CONVENIO block ---
  monedaConvenio: 55,
  convenioModificatorioConvenio: 56,
  codigoRefUltimoConvenio: 57,
  fechaFinUltimoConv: 58, // ISO
  montoSinImpMinConvenio: 59,
  montoConImpMinConvenio: 60,
  montoSinImpMaxConvenio: 61,
  montoConImpMaxConvenio: 62,
  fechaFirmaUltimoConv: 63, // ISO
  // --- Supplier (dedupe by rfc) ---
  rfc: 64,
  proveedor: 65,
  folioRupc: 66,
  pais: 67,
  nacionalidad: 68,
  autoRegistroCompranet: 69,
  estratificacion: 70,
  // 71 = origen (not modelled)
  direccionAnuncio: 72,
} as const;

/** Expected column count — used to guard against structurally malformed rows. */
export const EXPECTED_COLUMN_COUNT = 73;

/** Per-column date format: which columns are ISO vs DD/MM/YYYY (CI-3). */
export const DATE_FORMATS = {
  // ISO "YYYY-MM-DD HH:mm:ss" → timestamptz
  fechaPublicacion: 'iso',
  fechaApertura: 'iso',
  fechaFallo: 'iso',
  fechaFirma: 'iso',
  fechaFirmaContrato: 'iso',
  fechaFinUltimoConv: 'iso',
  fechaFirmaUltimoConv: 'iso',
  // DD/MM/YYYY → date
  fechaInicio: 'dmy',
  fechaFin: 'dmy',
} as const;

export type DateFmt = (typeof DATE_FORMATS)[keyof typeof DATE_FORMATS];
