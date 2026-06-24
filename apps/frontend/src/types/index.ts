/**
 * Frontend DTO types.
 *
 * These mirror the EXACT response shapes returned by the backend REST API
 * (see apps/backend/src/domain/repositories/procedure-query-repository.ts).
 * The API contract — not the DB schema — is the source of truth here.
 *
 * Conventions:
 * - Field names are snake_case (matches the JSON wire format).
 * - Dates are ISO strings (the backend's `Date` objects JSON-serialize to ISO).
 * - Amounts are numbers (backend already parses numeric(18,2) → number).
 */

// --- Pagination ---

export interface PaginationMeta {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

// --- List item (GET /procedures) ---

export interface InstitucionRef {
  nombre: string;
  clave: string;
  siglas: string | null;
}

export interface UnidadCompradoraRef {
  nombre: string;
  clave: string;
}

export interface ProcedureListItem {
  id: number;
  numero_procedimiento: string;
  descripcion: string | null;
  caracter: string | null;
  tipo_contratacion: string | null;
  tipo_procedimiento: string | null;
  ley: string | null;
  estatus: string | null;
  fecha_publicacion: string | null;
  fecha_apertura: string | null;
  fecha_fallo: string | null;
  importe_total: number;
  institucion: InstitucionRef;
  unidad_compradora: UnidadCompradoraRef;
}

export interface ProcedureListPage {
  data: ProcedureListItem[];
  pagination: PaginationMeta;
}

// --- Detail (GET /procedures/:numeroProcedimiento) ---

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
  fecha_publicacion: string | null;
  fecha_apertura: string | null;
  fecha_fallo: string | null;
  direccion_anuncio: string | null;
  contrato_marco: boolean | null;
  compra_consolidada: boolean | null;
  credito_externo: boolean | null;
  institucion: InstitutionView;
  unidad_compradora: PurchasingUnitView;
  expedientes: ExpedienteView[];
  contracts: ContractView[];
}

// --- Analytics ---

export interface DistribucionMontos {
  menor_100k: number;
  entre_100k_1m: number;
  entre_1m_10m: number;
  mayor_10m: number;
}

export interface EstatusGroup {
  estatus: string | null;
  total: number;
}

export interface AnalyticsSummary {
  total_monto: number;
  total_procedimientos: number;
  total_contratos: number;
  monto_promedio: number;
  distribucion_montos: DistribucionMontos;
  por_estatus: EstatusGroup[];
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

export interface TipoContratacionResult {
  por_tipo_contratacion: TipoGroup[];
  por_tipo_procedimiento: TipoGroup[];
}

// --- Filter params (matches shared procedureFilterSchema) ---

export interface ProcedureFilter {
  institucion?: string;
  tipo_contratacion?: string;
  tipo_procedimiento?: string;
  estatus?: string;
  proveedor?: string;
  ley?: string;
  monto_min?: number;
  monto_max?: number;
  fecha_desde?: string;
  fecha_hasta?: string;
  q?: string;
}

export type SortField =
  | 'fecha_publicacion'
  | 'fecha_apertura'
  | 'numero_procedimiento'
  | 'tipo_contratacion'
  | 'estatus'
  | 'importe_total';

export type SortOrder = 'asc' | 'desc';

export interface ProcedureListQuery extends ProcedureFilter {
  page: number;
  page_size: number;
  sort: SortField;
  order: SortOrder;
}

// --- API error ---

export interface ApiErrorBody {
  error?: string;
  message?: string;
  issues?: { path: string; message: string }[];
}

// --- Documents (Phase 5: on-demand Playwright fetch) ---

export type DocumentEstatus = 'pending' | 'fetched' | 'failed' | 'captcha_blocked';

export interface DocumentItem {
  id: number;
  titulo: string | null;
  tipo: string | null;
  url_fuente: string | null;
  archivo_local: string | null;
  fecha_descarga: string | null;
  estatus: string;
  error?: string;
  /** Present only when a local file was downloaded (archivo_local set). */
  download_url?: string;
}

export type FetchDocumentsStatus =
  | 'cached'
  | 'fetched'
  | 'captcha_blocked'
  | 'failed'
  | 'timeout'
  | 'no_anexos'
  | 'no_anuncio_url'
  | 'disabled';

export interface FetchDocumentsResponse {
  status: FetchDocumentsStatus;
  documents: DocumentItem[];
  message?: string;
}

// --- Market Intelligence (PR6) ---

export interface MarketOverview {
  total_contracts: number;
  total_amount: number;
  avg_amount: number;
  unique_suppliers: number;
  unique_buyers: number;
  by_year: { year: number; contracts: number; amount: number }[];
  segment_used_default: boolean;
}

export interface MarketCompetitor {
  nombre: string;
  rfc: string;
  contracts_count: number;
  total_amount: number;
  avg_amount: number;
  unique_buyers: number;
  market_share_pct: number;
}

export interface MarketBuyer {
  nombre: string;
  clave: string;
  contracts_count: number;
  total_amount: number;
  unique_suppliers: number;
  top_supplier: { nombre: string; rfc: string; market_share_pct: number } | null;
}

export interface MarketOpportunity {
  numero_procedimiento: string;
  descripcion: string | null;
  tipo_contratacion: string | null;
  estatus: string | null;
  fecha_apertura: string | null;
  fecha_fallo: string | null;
  institucion_nombre: string;
  institucion_clave: string;
  importe_estimado: number;
}

export interface MarketExpiringContract {
  contrato_id: number;
  numero_contrato: string | null;
  titulo: string | null;
  importe_drc: number | null;
  fecha_fin: string | null;
  supplier: { rfc: string; nombre: string } | null;
  institucion_nombre: string;
  institucion_clave: string;
  numero_procedimiento: string;
}

export interface MarketDominance {
  institution_nombre: string;
  institution_clave: string;
  dominant_supplier_nombre: string;
  dominant_supplier_rfc: string;
  dominant_share_pct: number;
  total_amount: number;
  contracts_count: number;
}

// --- Vigente procedures (PR7: currently-open bids from ComprasMX) ---

export interface VigenteItem {
  id: number;
  numero_procedimiento: string;
  nombre: string | null;
  caracter: string | null;
  dependencia: string | null;
  siglas_dependencia: string | null;
  estatus: string | null;
  fecha_junta_aclaraciones: string | null;
  fecha_presentacion_apertura: string | null;
  tipo_procedimiento: string | null;
  tipo_contratacion: string | null;
  unidad_compradora: string | null;
  codigo_expediente: string | null;
  uuid_procedimiento: string | null;
  direcciones_anuncio: string | null;
  entidad_federativa: string | null;
  scraped_at: string;
}

export interface VigenteListPage {
  data: VigenteItem[];
  pagination: PaginationMeta;
}

export interface VigenteFilter {
  tipo_contratacion?: string;
  tipo_procedimiento?: string;
  dependencia?: string;
  siglas?: string;
  entidad_federativa?: string;
  q?: string;
}

export type ScrapeStatus = 'ok' | 'blocked' | 'failed';

export interface ScrapeVigentesSummary {
  status: ScrapeStatus;
  totalReported: number | null;
  pagesScraped: number;
  found: number;
  inserted: number;
  updated: number;
  message?: string;
}

// --- Vigente on-demand detail (PR8) ---

/**
 * The RAW JSON bodies intercepted from ComprasMX's 3 detail API calls. They are
 * intentionally `unknown` here: the shapes are undocumented and live-captured
 * (#233). Defensive accessors in the detail renderer probe likely field names
 * rather than relying on a typed contract.
 *
 * Shapes (discovery #233):
 *  - detalle:    { success, data: { registro:[{...}], anexos:[...], req_economicos:[...],
 *                partidas:[...], idiomas:[...], grupos_req_economicos:[...], tratados:[...] } }
 *  - anexos:     { success, data:[{ registros:[{descripcion,tipodoc_descripcion,documentos}],
 *                paginacion:[{total_registros,...}] }] }
 *  - reqeconomicos: { success, data:[{ registros:[{grupo,total,descripcion_gp,data_registros}] }] }
 */
export type VigenteDetalleJson = unknown | null;

export type VigenteDetailStatus =
  | 'cached' // served from cache, Playwright not launched
  | 'fetched' // fresh fetch completed
  | 'captcha_blocked' // reCAPTCHA refused (graceful, #213)
  | 'failed' // page loaded but nothing intercepted
  | 'timeout' // wall-clock budget elapsed
  | 'no_anuncio_url' // procedure has no direccion_anuncio
  | 'stale_failed'; // fetch failed but a stale cache was served

/** GET /vigentes/:numero/detail — cached detail (or null fields if never fetched). */
export interface VigenteDetalleResponse {
  detalle: VigenteDetalleJson;
  anexos: VigenteDetalleJson;
  reqeconomicos: VigenteDetalleJson;
  detalle_fetched_at: string | null;
}

/** POST /vigentes/:numero/fetch-detail — on-demand fetch result. */
export interface FetchVigenteDetailResponse extends VigenteDetalleResponse {
  status: VigenteDetailStatus;
  message?: string;
}

// --- Supplier Intelligence (PR9) ---

export interface SupplierSearchResult {
  id: number;
  rfc: string;
  nombre: string;
  estratificacion: string | null;
  total_contracts: number;
  total_amount: number;
}

export interface SupplierSearchPage {
  data: SupplierSearchResult[];
  pagination: PaginationMeta;
}

export interface SupplierHeader {
  rfc: string;
  nombre: string;
  estratificacion: string | null;
  nacionalidad: string | null;
  pais: string | null;
  folio_rupc: string | null;
}

export interface SupplierSummary {
  total_contracts: number;
  total_amount: number;
  avg_amount: number;
  median_amount: number;
  years_active: string[];
  first_contract: string | null;
  last_contract: string | null;
  active_contracts: number;
  contracts_without_amount: number;
}

export interface SupplierInstitution {
  nombre: string;
  contracts: number;
  amount: number;
  share_pct: number;
}

export interface SupplierTipoContratacion {
  tipo: string;
  contracts: number;
  amount: number;
}

export interface SupplierYearBucket {
  year: number;
  contracts: number;
  amount: number;
}

export interface SupplierTopContract {
  numero_procedimiento: string;
  titulo: string | null;
  descripcion: string | null;
  importe_drc: number | null;
  institucion: string;
  fecha_firma: string | null;
  estatus_contrato: string | null;
}

export interface SupplierMarketPosition {
  rank_by_amount: number;
  total_suppliers: number;
  percentile: number;
}

export interface SupplierProfile {
  supplier: SupplierHeader;
  summary: SupplierSummary;
  by_institution: SupplierInstitution[];
  by_tipo_contratacion: SupplierTipoContratacion[];
  by_year: SupplierYearBucket[];
  top_contracts: SupplierTopContract[];
  market_position: SupplierMarketPosition | null;
}
