/**
 * Fórmula del score de oportunidad (PR14). Pesos y penalización son
 * constantes nombradas, no mágicas — ver spec para el razonamiento.
 */
const AMOUNT_WEIGHT = 0.6;
const COMPETITION_WEIGHT = 0.4;
const DOMINANCE_PENALTY = 30;

export interface ScoreInput {
  /** 0-100, ya normalizado contra los demás segmentos de la corrida. */
  amountScore: number;
  /** 0-100, ya normalizado (más alto = menos competencia). */
  competitionScore: number;
  isDominated: boolean;
}

export interface ScoreResult {
  score: number;
}

export function computeScore(input: ScoreInput): ScoreResult {
  const raw = AMOUNT_WEIGHT * input.amountScore + COMPETITION_WEIGHT * input.competitionScore;
  const penalized = input.isDominated ? raw - DOMINANCE_PENALTY : raw;
  const score = Math.max(0, Math.min(100, Math.round(penalized)));
  return { score };
}
