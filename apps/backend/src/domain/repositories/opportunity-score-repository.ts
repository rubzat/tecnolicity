/**
 * OpportunityScoreRepository — dominio port para `opportunity_segment_stats`
 * (PR14). Combina dos responsabilidades relacionadas: leer los datos
 * históricos crudos que alimentan el cálculo (agregación sobre
 * contracts/procedures/institutions/suppliers, igual que hace
 * MarketRepository) y leer/escribir la caché de resultados ya normalizados.
 */

/** Fila cruda por segmento, ANTES de normalizar (0-100) ni aplicar la fórmula final. */
export interface RawSegmentAggregate {
  tipoContratacion: string;
  siglasDependencia: string;
  sampleSize: number;
  medianAmount: number;
  distinctSuppliers: number;
  /** % de participación del proveedor con más monto en el segmento (0-100), null si no hay proveedor con monto. */
  dominantSupplierShare: number | null;
}

/** Fila normalizada y con score final — lo que se guarda en la tabla de caché. */
export interface OpportunitySegmentStats {
  tipoContratacion: string;
  siglasDependencia: string;
  sampleSize: number;
  medianAmount: number;
  amountScore: number;
  distinctSuppliers: number;
  competitionScore: number;
  dominantSupplierShare: number | null;
  isDominated: boolean;
  score: number;
}

export interface OpportunityScoreRepository {
  /**
   * Agrega TODOS los contratos históricos por (tipo_contratación, siglas),
   * sin filtrar por tamaño de muestra (ese filtro lo aplica el caso de uso).
   */
  computeRawSegmentAggregates(): Promise<RawSegmentAggregate[]>;

  /** Upsert de una fila normalizada — nunca trunca la tabla. */
  upsertSegment(stats: OpportunitySegmentStats): Promise<void>;

  /** Lectura directa de un segmento (usada en tests/inspección). */
  findBySegment(tipoContratacion: string, siglasDependencia: string): Promise<OpportunitySegmentStats | null>;
}
