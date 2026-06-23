import { describe, it, expect } from 'vitest';
import { buildSegmentTsQuery, escapeKeyword } from './segment-matcher.js';

describe('segment-matcher', () => {
  describe('escapeKeyword (legacy regex helper)', () => {
    it('escapes POSIX regex metacharacters', () => {
      expect(escapeKeyword('software')).toBe('software');
      expect(escapeKeyword('(gps)')).toBe('\\(gps\\)');
      expect(escapeKeyword('a+b*c?')).toBe('a\\+b\\*c\\?');
    });
  });

  describe('buildSegmentTsQuery', () => {
    it('joins single-word keywords with OR', () => {
      expect(buildSegmentTsQuery(['software', 'camara'])).toBe('software | camara');
    });

    it('lowercases and trims keywords', () => {
      expect(buildSegmentTsQuery(['  Software  ', 'GPS'])).toBe('software | gps');
    });

    it('emits multi-word keywords as adjacency phrases (<->)', () => {
      expect(buildSegmentTsQuery(['equipo de cómputo'])).toBe(
        '(equipo <-> de <-> cómputo)',
      );
    });

    it('mixes single words and phrases in one OR expression', () => {
      expect(buildSegmentTsQuery(['software', 'circuito cerrado'])).toBe(
        'software | (circuito <-> cerrado)',
      );
    });

    it('de-duplicates case-insensitively', () => {
      expect(buildSegmentTsQuery(['Software', 'SOFTWARE', 'camara'])).toBe(
        'software | camara',
      );
    });

    it('collapses internal whitespace in a phrase', () => {
      expect(buildSegmentTsQuery(['equipo   de    cómputo'])).toBe(
        '(equipo <-> de <-> cómputo)',
      );
    });

    it('returns an empty string for an empty/whitespace list', () => {
      // Callers MUST treat '' as "match nothing" — to_tsquery('') would error.
      expect(buildSegmentTsQuery([])).toBe('');
      expect(buildSegmentTsQuery(['   ', ''])).toBe('');
    });
  });
});
