import type {
  OpportunityScoreRepository,
  RawSegmentAggregate,
  OpportunitySegmentStats,
} from '../../domain/repositories/opportunity-score-repository.js';
import { computeScore } from './opportunity-score-calculator.js';

/** Segmentos con menos contratos de respaldo que esto no reciben score. */
const MIN_SAMPLE_SIZE = 3;

/**
 * Normaliza (min-max, 0-100) los agregados crudos contra TODOS los segmentos
 * que califican en esta corrida, y calcula el score final de cada uno. Función
 * pura — sin I/O — para que sea testeable sin tocar la base de datos.
 */
export function normalizeAndScore(raw: RawSegmentAggregate[]): OpportunitySegmentStats[] {
  const qualifying = raw.filter((r) => r.sampleSize >= MIN_SAMPLE_SIZE);
  if (qualifying.length === 0) return [];

  const amounts = qualifying.map((r) => r.medianAmount);
  const minAmount = Math.min(...amounts);
  const maxAmount = Math.max(...amounts);

  const supplierCounts = qualifying.map((r) => r.distinctSuppliers);
  const minSuppliers = Math.min(...supplierCounts);
  const maxSuppliers = Math.max(...supplierCounts);

  return qualifying.map((r) => {
    const amountScore = normalize(r.medianAmount, minAmount, maxAmount);
    // Invertido: menos proveedores = menos competencia = score más alto.
    const competitionScore = 100 - normalize(r.distinctSuppliers, minSuppliers, maxSuppliers);
    const isDominated = (r.dominantSupplierShare ?? 0) >= 60;
    const { score } = computeScore({ amountScore, competitionScore, isDominated });

    return {
      tipoContratacion: r.tipoContratacion,
      siglasDependencia: r.siglasDependencia,
      sampleSize: r.sampleSize,
      medianAmount: r.medianAmount,
      amountScore,
      distinctSuppliers: r.distinctSuppliers,
      competitionScore,
      dominantSupplierShare: r.dominantSupplierShare,
      isDominated,
      score,
    };
  });
}

/** Min-max a 0-100. 50 (neutral) cuando no hay varianza (min === max). */
function normalize(value: number, min: number, max: number): number {
  if (max === min) return 50;
  return Math.round((100 * (value - min)) / (max - min));
}

export interface ComputeOpportunityScoresDeps {
  repository: OpportunityScoreRepository;
}

export interface ComputeOpportunityScoresSummary {
  segmentsEvaluated: number;
  segmentsScored: number;
}

/**
 * Caso de uso (PR14): agrega el histórico de contratos por segmento,
 * normaliza y calcula el score final, y persiste cada segmento calificado
 * vía upsert. Se dispara desde el mismo hook onScrapeComplete que ya usa
 * EvaluateAlerts — ver Task 5.
 */
export class ComputeOpportunityScores {
  constructor(private readonly deps: ComputeOpportunityScoresDeps) {}

  async execute(): Promise<ComputeOpportunityScoresSummary> {
    const raw = await this.deps.repository.computeRawSegmentAggregates();
    const scored = normalizeAndScore(raw);
    for (const row of scored) {
      await this.deps.repository.upsertSegment(row);
    }
    return { segmentsEvaluated: raw.length, segmentsScored: scored.length };
  }
}
