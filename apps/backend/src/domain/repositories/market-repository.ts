import type { PaginationMeta } from '../../application/queries/pagination.js';

/**
 * Market Intelligence repository port (PR6).
 *
 * Domain contract (hexagonal port). Every method takes a pre-parsed segment
 * pattern string (see `segment-matcher.ts`) so the matcher logic stays out of
 * the repository and is easy to unit-test. The Drizzle implementation lives in
 * `infrastructure/db/repositories/market-repository.ts`.
 *
 * Amount semantics match the rest of the portal: `importe_drc` is summed
 * (NULLs excluded by SUM), and counts include rows with NULL amounts.
 */

// --- Overview (GET /market/overview) ---

export interface MarketOverview {
  total_contracts: number;
  total_amount: number;
  avg_amount: number;
  unique_suppliers: number;
  unique_buyers: number;
  by_year: { year: number; contracts: number; amount: number }[];
}

// --- Competitors (GET /market/competitors) ---

export interface MarketCompetitor {
  nombre: string;
  rfc: string;
  contracts_count: number;
  total_amount: number;
  avg_amount: number;
  /** Number of distinct buying institutions this supplier sells to. */
  unique_buyers: number;
  /** Share of the segment's total amount (0..100). */
  market_share_pct: number;
}

// --- Buyers (GET /market/buyers) ---

export interface MarketBuyer {
  nombre: string;
  clave: string;
  contracts_count: number;
  total_amount: number;
  unique_suppliers: number;
  /** Supplier that captures the most amount within this institution. */
  top_supplier: { nombre: string; rfc: string; market_share_pct: number } | null;
}

// --- Opportunities (GET /market/opportunities) ---

export interface MarketOpportunity {
  numero_procedimiento: string;
  descripcion: string | null;
  tipo_contratacion: string | null;
  estatus: string | null;
  fecha_apertura: string | null;
  fecha_fallo: string | null;
  institucion_nombre: string;
  institucion_clave: string;
  /** Best available estimate = sum of this procedure's contract importe_drc. */
  importe_estimado: number;
}

export interface MarketOpportunityPage {
  data: MarketOpportunity[];
  pagination: PaginationMeta;
}

// --- Expiring (GET /market/expiring) ---

export interface MarketExpiringContract {
  contrato_id: number;
  numero_contrato: string | null;
  titulo: string | null;
  importe_drc: number | null;
  fecha_fin: string | null;
  /** Current incumbent supplier (RFC + name). */
  supplier: { rfc: string; nombre: string } | null;
  institucion_nombre: string;
  institucion_clave: string;
  numero_procedimiento: string;
}

// --- Dominance (GET /market/dominance) ---

export interface MarketDominance {
  institution_nombre: string;
  institution_clave: string;
  dominant_supplier_nombre: string;
  dominant_supplier_rfc: string;
  dominant_share_pct: number;
  total_amount: number;
  contracts_count: number;
}

/** The port. */
export interface MarketRepository {
  overview(pattern: string): Promise<MarketOverview>;
  competitors(pattern: string, limit: number): Promise<MarketCompetitor[]>;
  buyers(pattern: string, limit: number): Promise<MarketBuyer[]>;
  opportunities(
    pattern: string,
    page: number,
    pageSize: number,
  ): Promise<MarketOpportunityPage>;
  expiring(
    pattern: string,
    months: number,
    limit: number,
  ): Promise<MarketExpiringContract[]>;
  dominance(pattern: string, limit: number): Promise<MarketDominance[]>;
}
