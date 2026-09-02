import { describe, it, expect } from 'vitest';
import { normalizeAndScore, ComputeOpportunityScores } from './compute-opportunity-scores.js';
import type {
  OpportunityScoreRepository,
  RawSegmentAggregate,
  OpportunitySegmentStats,
} from '../../domain/repositories/opportunity-score-repository.js';

describe('normalizeAndScore', () => {
  it('descarta segmentos con menos de 3 contratos de muestra', () => {
    const raw: RawSegmentAggregate[] = [
      { tipoContratacion: 'A', siglasDependencia: 'X', sampleSize: 2, medianAmount: 100, distinctSuppliers: 1, dominantSupplierShare: 100 },
      { tipoContratacion: 'B', siglasDependencia: 'Y', sampleSize: 5, medianAmount: 200, distinctSuppliers: 3, dominantSupplierShare: 40 },
    ];
    const result = normalizeAndScore(raw);
    expect(result).toHaveLength(1);
    expect(result[0]!.tipoContratacion).toBe('B');
  });

  it('normaliza amount_score con min-max contra todos los segmentos calificados', () => {
    const raw: RawSegmentAggregate[] = [
      { tipoContratacion: 'A', siglasDependencia: 'X', sampleSize: 3, medianAmount: 0, distinctSuppliers: 5, dominantSupplierShare: 0 },
      { tipoContratacion: 'B', siglasDependencia: 'Y', sampleSize: 3, medianAmount: 1000, distinctSuppliers: 5, dominantSupplierShare: 0 },
    ];
    const result = normalizeAndScore(raw);
    const a = result.find((r) => r.tipoContratacion === 'A')!;
    const b = result.find((r) => r.tipoContratacion === 'B')!;
    expect(a.amountScore).toBe(0);
    expect(b.amountScore).toBe(100);
  });

  it('invierte competition_score: menos proveedores = score más alto', () => {
    const raw: RawSegmentAggregate[] = [
      { tipoContratacion: 'A', siglasDependencia: 'X', sampleSize: 3, medianAmount: 100, distinctSuppliers: 1, dominantSupplierShare: 100 },
      { tipoContratacion: 'B', siglasDependencia: 'Y', sampleSize: 3, medianAmount: 100, distinctSuppliers: 10, dominantSupplierShare: 20 },
    ];
    const result = normalizeAndScore(raw);
    const a = result.find((r) => r.tipoContratacion === 'A')!; // 1 proveedor -> menos competencia
    const b = result.find((r) => r.tipoContratacion === 'B')!; // 10 proveedores -> más competencia
    expect(a.competitionScore).toBe(100);
    expect(b.competitionScore).toBe(0);
  });

  it('usa 50 (neutral) cuando todos los segmentos tienen el mismo valor (sin varianza)', () => {
    const raw: RawSegmentAggregate[] = [
      { tipoContratacion: 'A', siglasDependencia: 'X', sampleSize: 3, medianAmount: 500, distinctSuppliers: 4, dominantSupplierShare: 0 },
      { tipoContratacion: 'B', siglasDependencia: 'Y', sampleSize: 3, medianAmount: 500, distinctSuppliers: 4, dominantSupplierShare: 0 },
    ];
    const result = normalizeAndScore(raw);
    expect(result[0]!.amountScore).toBe(50);
    expect(result[1]!.competitionScore).toBe(50);
  });

  it('marca is_dominated cuando dominant_supplier_share >= 60', () => {
    const raw: RawSegmentAggregate[] = [
      { tipoContratacion: 'A', siglasDependencia: 'X', sampleSize: 3, medianAmount: 100, distinctSuppliers: 2, dominantSupplierShare: 60 },
      { tipoContratacion: 'B', siglasDependencia: 'Y', sampleSize: 3, medianAmount: 100, distinctSuppliers: 2, dominantSupplierShare: 59.9 },
    ];
    const result = normalizeAndScore(raw);
    expect(result.find((r) => r.tipoContratacion === 'A')!.isDominated).toBe(true);
    expect(result.find((r) => r.tipoContratacion === 'B')!.isDominated).toBe(false);
  });

  it('trata dominant_supplier_share null como 0 (no dominado)', () => {
    const raw: RawSegmentAggregate[] = [
      { tipoContratacion: 'A', siglasDependencia: 'X', sampleSize: 3, medianAmount: 100, distinctSuppliers: 2, dominantSupplierShare: null },
      { tipoContratacion: 'B', siglasDependencia: 'Y', sampleSize: 3, medianAmount: 200, distinctSuppliers: 3, dominantSupplierShare: 10 },
    ];
    const result = normalizeAndScore(raw);
    expect(result.find((r) => r.tipoContratacion === 'A')!.isDominated).toBe(false);
  });

  it('devuelve una lista vacía si ningún segmento califica', () => {
    const raw: RawSegmentAggregate[] = [
      { tipoContratacion: 'A', siglasDependencia: 'X', sampleSize: 1, medianAmount: 100, distinctSuppliers: 1, dominantSupplierShare: null },
    ];
    expect(normalizeAndScore(raw)).toEqual([]);
  });
});

describe('ComputeOpportunityScores', () => {
  class FakeOpportunityScoreRepository implements OpportunityScoreRepository {
    raw: RawSegmentAggregate[] = [];
    upserted: OpportunitySegmentStats[] = [];
    async computeRawSegmentAggregates() {
      return this.raw;
    }
    async upsertSegment(stats: OpportunitySegmentStats) {
      this.upserted.push(stats);
    }
    async findBySegment() {
      return null;
    }
  }

  it('agrega, normaliza, y hace upsert de cada segmento calificado', async () => {
    const repo = new FakeOpportunityScoreRepository();
    repo.raw = [
      { tipoContratacion: 'A', siglasDependencia: 'X', sampleSize: 3, medianAmount: 100, distinctSuppliers: 2, dominantSupplierShare: 70 },
      { tipoContratacion: 'B', siglasDependencia: 'Y', sampleSize: 1, medianAmount: 200, distinctSuppliers: 1, dominantSupplierShare: null },
    ];
    const usecase = new ComputeOpportunityScores({ repository: repo });

    const summary = await usecase.execute();

    expect(summary.segmentsEvaluated).toBe(2);
    expect(summary.segmentsScored).toBe(1); // el segmento B no califica (sampleSize=1)
    expect(repo.upserted).toHaveLength(1);
    expect(repo.upserted[0]!.tipoContratacion).toBe('A');
    expect(repo.upserted[0]!.isDominated).toBe(true);
  });

  it('no falla si no hay ningún segmento que califique', async () => {
    const repo = new FakeOpportunityScoreRepository();
    repo.raw = [];
    const usecase = new ComputeOpportunityScores({ repository: repo });
    const summary = await usecase.execute();
    expect(summary.segmentsEvaluated).toBe(0);
    expect(summary.segmentsScored).toBe(0);
    expect(repo.upserted).toHaveLength(0);
  });
});
