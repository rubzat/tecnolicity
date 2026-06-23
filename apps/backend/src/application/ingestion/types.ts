/**
 * Entity-shaped objects produced by the row mapper. FK id columns are replaced
 * by NATURAL KEY references (`claveInstitucion`, `claveUc`, `rfc`,
 * `numeroProcedimiento`) — the repository layer resolves these to integer ids
 * AFTER upserting the parents (so insertion order follows the FK graph).
 */

export interface MappedInstitution {
  claveInstitucion: string;
  nombreInstitucion: string;
  siglas: string | null;
  ordenGobierno: string | null;
  claveRamo: string | null;
  descripcionRamo: string | null;
  tipoInstitucion: string | null;
}

export interface MappedPurchasingUnit {
  claveUc: string;
  nombreUc: string;
  /** Ref to institutions.clave_institucion. */
  claveInstitucion: string;
}

export interface MappedSupplier {
  rfc: string;
  nombre: string;
  folioRupc: string | null;
  pais: string | null;
  nacionalidad: string | null;
  estratificacion: string | null;
  autoRegistroCompranet: string | null;
}

export interface MappedProcedure {
  numeroProcedimiento: string;
  /** Ref to purchasing_units.clave_uc. */
  claveUc: string;
  caracter: string | null;
  tipoContratacion: string | null;
  tipoProcedimiento: string | null;
  ley: string | null;
  articuloExcepcion: string | null;
  descripcionExcepcion: string | null;
  contratoMarco: boolean | null;
  compraConsolidada: boolean | null;
  formaParticipacion: string | null;
  casoFortuito: string | null;
  creditoExterno: boolean | null;
  estatus: string | null;
  fechaPublicacion: string | null;
  fechaApertura: string | null;
  fechaFallo: string | null;
  direccionAnuncio: string | null;
  /** Best-effort descriptive text (mapped from the expediente título). */
  descripcion: string | null;
}

export interface MappedExpediente {
  codigoExpediente: string | null;
  referencia: string | null;
  titulo: string | null;
  partidaEspecifica: string | null;
}

export interface MappedContract {
  codigoContrato: string | null;
  numeroContrato: string | null;
  titulo: string | null;
  descripcion: string | null;
  contratoPlurianual: boolean | null;
  estatusDrc: string | null;
  /** DATE 'YYYY-MM-DD' or null. */
  fechaInicio: string | null;
  fechaFin: string | null;
  fechaFirma: string | null;
  fechaFirmaContrato: string | null;
  /** numeric(18,2) as string or null. */
  importeDrc: string | null;
  moneda: string;
  convenioModificatorio: boolean | null;
  codigoRefContrato: string | null;
  estatusContrato: string | null;
  tipoContrato: string | null;
  /** Ref to suppliers.rfc; null when the contract has no supplier. */
  rfc: string | null;
}

export type AmountTipo = 'original' | 'convenio';

export interface MappedAmount {
  tipo: AmountTipo;
  montoSinImpMin: string | null;
  montoConImpMin: string | null;
  montoSinImpMax: string | null;
  montoConImpMax: string | null;
  moneda: string;
  codigoRef: string | null;
  /** DATE 'YYYY-MM-DD' or null (only meaningful for convenio rows). */
  fechaFinConvenio: string | null;
}

/** Full mapped output for one CSV row. */
export interface MappedRow {
  institution: MappedInstitution;
  purchasingUnit: MappedPurchasingUnit;
  /** null when the row has no RFC (unmatched supplier). */
  supplier: MappedSupplier | null;
  procedure: MappedProcedure;
  expediente: MappedExpediente;
  contract: MappedContract;
  amounts: {
    original: MappedAmount | null;
    convenio: MappedAmount | null;
  };
}
