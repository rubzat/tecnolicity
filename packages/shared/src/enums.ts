/**
 * Estatus of a document in the fetching pipeline.
 * State machine: pending → fetched | failed | captcha_blocked
 */
export const DocumentEstatus = {
  PENDING: 'pending',
  FETCHED: 'fetched',
  FAILED: 'failed',
  CAPTCHA_BLOCKED: 'captcha_blocked',
} as const;
export type DocumentEstatus = (typeof DocumentEstatus)[keyof typeof DocumentEstatus];

/** Under which law a procedure falls. */
export const Ley = {
  OBRAS_PUBLICAS: 'Obras Públicas',
  ADQUISICIONES: 'Adquisiciones',
} as const;
export type Ley = (typeof Ley)[keyof typeof Ley];

/** Character of a procedure (international, national, etc.). */
export const Caracter = {
  INTERNACIONAL: 'Internacional',
  NACIONAL: 'Nacional',
  ABIERTO: 'Abierto',
} as const;
export type Caracter = (typeof Caracter)[keyof typeof Caracter];

/** Contract amount type — original or modified via convenio. */
export const ContractAmountTipo = {
  ORIGINAL: 'original',
  CONVENIO: 'convenio',
} as const;
export type ContractAmountTipo = (typeof ContractAmountTipo)[keyof typeof ContractAmountTipo];

/** Contract tipo_contrato values. */
export const TipoContrato = {
  BIENES: 'Bienes',
  SERVICIOS: 'Servicios',
  OBRA_PUBLICA: 'Obra Pública',
  ARRENDAMIENTOS: 'Arrendamientos',
} as const;
export type TipoContrato = (typeof TipoContrato)[keyof typeof TipoContrato];
