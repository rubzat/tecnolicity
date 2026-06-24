import type { PaginationMeta } from '../../application/queries/pagination.js';

/**
 * Supplier Intelligence repository port (PR9).
 *
 * Domain contract (hexagonal port). Two read methods:
 *  - `search`: accent-insensitive name/RFC search with per-supplier totals.
 *  - `getProfile`: a full business analysis of one supplier against the
 *    government dataset (summary, institutions, contract types, yearly
 *    evolution, top contracts, and market position/rank).
 *
 * Amount semantics match the rest of the portal: `importe_drc` is summed
 * (NULLs excluded by SUM), and counts include rows with NULL amounts.
 * The Drizzle implementation lives in
 * `infrastructure/db/repositories/supplier-repository.ts`.
 */

// --- Search (GET /suppliers/search) ---

export interface SupplierSearchResult {
  id: number;
  rfc: string;
  nombre: string;
  estratificacion: string | null;
  /** Total contracts for this supplier (including those with NULL amounts). */
  total_contracts: number;
  /** Sum of importe_drc (NULLs excluded). 0 when none have amounts. */
  total_amount: number;
}

export interface SupplierSearchPage {
  data: SupplierSearchResult[];
  pagination: PaginationMeta;
}

// --- Profile (GET /suppliers/:rfc/profile) ---

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
  /** Median of non-null importe_drc (0 when fewer than 2 amounts). */
  median_amount: number;
  /** Distinct years the supplier signed contracts (from fecha_firma/fecha_inicio). */
  years_active: string[];
  /** Earliest contract date (ISO) — null when the supplier has no contracts. */
  first_contract: string | null;
  /** Most recent contract date (ISO) — null when the supplier has no contracts. */
  last_contract: string | null;
  /** Contracts whose fecha_fin is today or later (active/vigente). */
  active_contracts: number;
  /** Contracts with a NULL importe_drc (kept separate from the amount math). */
  contracts_without_amount: number;
}

export interface SupplierInstitution {
  nombre: string;
  contracts: number;
  amount: number;
  /** Share of the supplier's total amount that comes from this agency (0..100). */
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
  /** 1-based rank among all suppliers by total amount (1 = biggest). */
  rank_by_amount: number;
  /** Total suppliers that have at least one contract. */
  total_suppliers: number;
  /** Percentile (0..100): share of suppliers with LESS total amount. */
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

/** The port. */
export interface SupplierRepository {
  /**
   * Accent-insensitive search by name OR RFC. `needle` is the pre-normalized
   * (lowercased, accent-stripped, wildcard-escaped) search string produced by
   * {@link buildSupplierSearchPredicate}.
   */
  search(
    needle: string,
    page: number,
    pageSize: number,
  ): Promise<SupplierSearchPage>;

  /** Full supplier analysis. Returns null when the RFC does not exist. */
  getProfile(rfc: string): Promise<SupplierProfile | null>;
}
