import { describe, it, expect } from 'vitest';
import {
  computePagination,
  resolveSort,
  SORTABLE_FIELDS,
} from './pagination.js';

describe('computePagination', () => {
  it('computes offset/limit/total_pages for the first page', () => {
    const { offset, limit, meta } = computePagination(1, 20, 100);
    expect(offset).toBe(0);
    expect(limit).toBe(20);
    expect(meta).toEqual({ page: 1, page_size: 20, total: 100, total_pages: 5 });
  });

  it('advances the offset for later pages', () => {
    const { offset } = computePagination(3, 20, 100);
    expect(offset).toBe(40);
  });

  it('rounds total_pages up for a partial last page', () => {
    const { meta } = computePagination(1, 20, 101);
    expect(meta.total_pages).toBe(6);
  });

  it('reports zero total_pages for an empty dataset (scenario 3)', () => {
    const { meta, offset } = computePagination(1, 20, 0);
    expect(meta.total_pages).toBe(0);
    expect(meta.total).toBe(0);
    // Offset still computed; query returns empty at runtime (scenario 4).
    expect(offset).toBe(0);
  });

  it('allows an offset beyond the last page without error (scenario 4)', () => {
    // page 10 with 100 rows / 20 per page → past the last page.
    const { offset, meta } = computePagination(10, 20, 100);
    expect(meta.total_pages).toBe(5);
    expect(offset).toBe(180); // (10-1)*20 — query yields an empty page
  });

  it('clamps invalid/zero page and page_size to safe minimums', () => {
    expect(computePagination(0, 20, 50).meta.page).toBe(1);
    expect(computePagination(-3, 20, 50).meta.page).toBe(1);
    expect(computePagination(1, 0, 50).limit).toBe(1);
    expect(computePagination(2.9, 1.9, 50).meta).toMatchObject({ page: 2, page_size: 1 });
  });
});

describe('resolveSort', () => {
  it('maps a known snake_case field to a column expression', () => {
    const { field } = resolveSort('fecha_publicacion', 'desc');
    expect(field).toBe('fecha_publicacion');
  });

  it('resolves the aggregate alias importe_total', () => {
    const { field } = resolveSort('importe_total', 'asc');
    expect(field).toBe('importe_total');
  });

  it('falls back to fecha_publicacion for an unknown field', () => {
    const { field } = resolveSort('evil; DROP TABLE', 'desc');
    expect(field).toBe('fecha_publicacion');
  });

  it('falls back to fecha_publicacion when the field is absent', () => {
    const { field } = resolveSort(undefined, 'asc');
    expect(field).toBe('fecha_publicacion');
  });

  it('only ever returns whitelisted fields (injection guard)', () => {
    for (const attempt of ['', 'unknown', 'id', 'embedding', '*', '1; --']) {
      expect(SORTABLE_FIELDS).toContain(resolveSort(attempt, 'asc').field);
    }
  });
});
