import { describe, it, expect } from 'vitest';
import { computeScore } from './opportunity-score-calculator.js';

describe('computeScore', () => {
  it('combina amount_score (60%) y competition_score (40%) sin dominancia', () => {
    const { score } = computeScore({ amountScore: 100, competitionScore: 0, isDominated: false });
    expect(score).toBe(60); // 0.6*100 + 0.4*0 = 60
  });

  it('aplica la penalización de -30 cuando hay un proveedor dominante', () => {
    const { score } = computeScore({ amountScore: 100, competitionScore: 100, isDominated: true });
    expect(score).toBe(70); // (0.6*100+0.4*100)=100, -30 = 70
  });

  it('nunca baja de 0 aunque la penalización lo empuje negativo', () => {
    const { score } = computeScore({ amountScore: 10, competitionScore: 0, isDominated: true });
    expect(score).toBe(0); // 0.6*10=6, -30 = -24 -> clamped a 0
  });

  it('nunca sube de 100', () => {
    const { score } = computeScore({ amountScore: 100, competitionScore: 100, isDominated: false });
    expect(score).toBe(100);
  });

  it('redondea al entero más cercano', () => {
    const { score } = computeScore({ amountScore: 33, competitionScore: 67, isDominated: false });
    // 0.6*33 + 0.4*67 = 19.8 + 26.8 = 46.6 -> 47
    expect(score).toBe(47);
  });
});
