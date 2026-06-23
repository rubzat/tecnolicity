import type { ProcedureFilter } from '@tecnolicity/shared';
import type { PaginationMeta } from '../../application/queries/pagination.js';

/**
 * Read-side repository port for procedure queries + cost analytics.
 *
 * This is the DOMAIN contract (hexagonal port). The Drizzle implementation
 * lives in `infrastructure/db/repositories/procedure-query-repository.ts`.
 * Application use cases depend on THIS interface, never on Drizzle.
 */

// --- List result shape (PQ-1) ---

export interface ProcedureListItem {
  id: number;
  numero_procedimiento: string;
  /** Best descriptive title for the procedure (= expediente título). */
  descripcion: string | null;
  caracter: string | null;
  tipo_contratacion: string | null;
  tipo_procedimiento: string | null;
  ley: string | null;
  estatus: string | null;
  fecha_publicacion: Date | null;
  fecha_apertura: Date | null;
  fecha_fallo: Date | null;
  /** Sum of this procedure's contract `importe_drc` (0 when none). */
  importe_total: number;
  institucion: {
    nombre: string;
    clave: string;
    siglas: string | null;
  };
  unidad_compradora: {
    nombre: string;
    clave: string;
  };
}

export interface ProcedureListPage {
  data: ProcedureListItem[];
  pagination: PaginationMeta;
}

// --- Detail result shape (PQ-4) ---

export interface InstitutionView {
  clave: string;
  nombre: string;
  siglas: string | null;
  orden_gobierno: string | null;
  clave_ramo: string | null;
  descripcion_ramo: string | null;
}

export interface PurchasingUnitView {
  clave: string;
  nombre: string;
}

export interface ExpedienteView {
  codigo_expediente: string | null;
  referencia: string | null;
  titulo: string | null;
  partida_especifica: string | null;
}

export interface AmountView {
  tipo: 'original' | 'convenio';
  monto_sin_imp_min: number | null;
  monto_con_imp_min: number | null;
  monto_sin_imp_max: number | null;
  monto_con_imp_max: number | null;
  moneda: string;
  codigo_ref: string | null;
  fecha_fin_convenio: string | null;
}

export interface SupplierView {
  rfc: string;
  nombre: string;
  folio_rupc: string | null;
  pais: string | null;
  estratificacion: string | null;
}

export interface ContractView {
  id: number;
  codigo_contrato: string | null;
  numero_contrato: string | null;
  titulo: string | null;
  descripcion: string | null;
  importe_drc: number | null;
  moneda: string;
  estatus_drc: string | null;
  tipo_contrato: string | null;
  contrato_plurianual: boolean | null;
  convenio_modificatorio: boolean | null;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  fecha_firma: string | null;
  supplier: SupplierView | null;
  amounts: AmountView[];
}

export interface ProcedureDetail {
  id: number;
  numero_procedimiento: string;
  descripcion: string | null;
  caracter: string | null;
  tipo_contratacion: string | null;
  tipo_procedimiento: string | null;
  ley: string | null;
  estatus: string | null;
  forma_participacion: string | null;
  fecha_publicacion: Date | null;
  fecha_apertura: Date | null;
  fecha_fallo: Date | null;
  direccion_anuncio: string | null;
  contrato_marco: boolean | null;
  compra_consolidada: boolean | null;
  credito_externo: boolean | null;
  institucion: InstitutionView;
  unidad_compradora: PurchasingUnitView;
  expedientes: ExpedienteView[];
  contracts: ContractView[];
}

// --- Analytics result shapes (CA-1 .. CA-6) ---

export interface AnalyticsSummary {
  total_monto: number;
  total_procedimientos: number;
  total_contratos: number;
  monto_promedio: number;
  /** Amount distribution across ranges (CA-4). Counts contracts. */
  distribucion_montos: {
    menor_100k: number;
    entre_100k_1m: number;
    entre_1m_10m: number;
    mayor_10m: number;
  };
  /** Procedure counts grouped by estatus (CA-5). */
  por_estatus: { estatus: string | null; total: number }[];
}

export interface InstitucionGroup {
  clave: string;
  nombre: string;
  siglas: string | null;
  total_monto: number;
  total_procedimientos: number;
  total_contratos: number;
}

export interface TipoGroup {
  clave: string | null;
  total_monto: number;
  total_procedimientos: number;
  total_contratos: number;
}

export interface SupplierGroup {
  rfc: string;
  nombre: string;
  total_monto: number;
  total_contratos: number;
}

/** Parameters for ranked analytics endpoints. */
export interface AnalyticsParams extends ProcedureFilter {
  limit: number;
}

/** The port. Implemented once by the Drizzle repository. */
export interface ProcedureQueryRepository {
  // PQ
  list(
    filters: ProcedureFilter,
    page: number,
    pageSize: number,
    sort: string,
    order: 'asc' | 'desc',
  ): Promise<ProcedureListPage>;
  getDetail(numeroProcedimiento: string): Promise<ProcedureDetail | null>;

  // CA
  summary(filters: ProcedureFilter): Promise<AnalyticsSummary>;
  byInstitucion(params: AnalyticsParams): Promise<InstitucionGroup[]>;
  byTipoContratacion(filters: ProcedureFilter): Promise<{
    por_tipo_contratacion: TipoGroup[];
    por_tipo_procedimiento: TipoGroup[];
  }>;
  topProveedores(params: AnalyticsParams): Promise<SupplierGroup[]>;
}
