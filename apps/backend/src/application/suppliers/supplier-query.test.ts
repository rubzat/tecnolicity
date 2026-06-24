import { describe, it, expect } from 'vitest';
import { buildSupplierSearchPredicate } from './supplier-query.js';

/**
 * Unit tests for the supplier search query normalizer (PR9).
 *
 * The normalizer must: lowercase, strip diacritics (NFD + combining-mark
 * removal), and escape LIKE wildcards so a literal `%`/`_` in the query is
 * matched literally (not treated as a wildcard). It is the JS half of the
 * accent-insensitive search; the DB half mirrors this with translate().
 */
describe('buildSupplierSearchPredicate', () => {
  it('lowercases the query', () => {
    expect(buildSupplierSearchPredicate('AXTEL')).toBe('axtel');
  });

  it('strips Spanish diacritics (NFD decomposition)', () => {
    expect(buildSupplierSearchPredicate('Cámara')).toBe('camara');
    expect(buildSupplierSearchPredicate('ANÁLISIS')).toBe('analisis');
    expect(buildSupplierSearchPredicate('Niño')).toBe('nino');
    expect(buildSupplierSearchPredicate('COMUNICACIÓN')).toBe('comunicacion');
  });

  it('strips foreign diacritics', () => {
    expect(buildSupplierSearchPredicate('café')).toBe('cafe');
    expect(buildSupplierSearchPredicate('über')).toBe('uber');
  });

  it('trims surrounding whitespace', () => {
    expect(buildSupplierSearchPredicate('  axtel  ')).toBe('axtel');
  });

  it('returns empty string for blank input', () => {
    expect(buildSupplierSearchPredicate('')).toBe('');
    expect(buildSupplierSearchPredicate('   ')).toBe('');
  });

  it('escapes LIKE wildcard characters with a backslash', () => {
    // A literal % or _ in the query must not act as a wildcard.
    expect(buildSupplierSearchPredicate('50%_desc')).toBe('50\\%\\_desc');
  });

  it('preserves internal whitespace (multi-word names)', () => {
    expect(buildSupplierSearchPredicate('ICA CONSTRUCTORA')).toBe('ica constructora');
  });

  it('combines lowercasing + accent stripping + escaping', () => {
    expect(buildSupplierSearchPredicate('Cámara 50%')).toBe('camara 50\\%');
  });
});
