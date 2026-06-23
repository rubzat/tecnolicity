import { describe, it, expect } from 'vitest';
import {
  normalizeTimestamp,
  normalizeDateOnly,
  detectFormat,
} from './date-normalizer';

describe('date-normalizer', () => {
  describe('detectFormat', () => {
    it('detects ISO format', () => {
      expect(detectFormat('2026-03-23 20:33:39')).toBe('iso');
      expect(detectFormat('2026-03-23')).toBe('iso');
    });

    it('detects DD/MM/YYYY format', () => {
      expect(detectFormat('24/03/2026')).toBe('dmy');
      expect(detectFormat('1/4/2026')).toBe('dmy');
    });
  });

  describe('normalizeTimestamp (ISO)', () => {
    it('parses ISO YYYY-MM-DD HH:mm:ss to UTC ISO string', () => {
      const out = normalizeTimestamp('2026-03-23 20:33:39', 'iso');
      expect(out).toBe('2026-03-23T20:33:39.000Z');
    });

    it('parses ISO date-only', () => {
      expect(normalizeTimestamp('2026-02-17', 'iso')).toBe('2026-02-17T00:00:00.000Z');
    });

    it('returns null for empty', () => {
      expect(normalizeTimestamp('', 'iso')).toBeNull();
      expect(normalizeTimestamp(null, 'iso')).toBeNull();
      expect(normalizeTimestamp(undefined, 'iso')).toBeNull();
    });

    it('returns null for unparseable ISO', () => {
      expect(normalizeTimestamp('not-a-date', 'iso')).toBeNull();
      expect(normalizeTimestamp('2026-13-99', 'iso')).toBeNull();
    });
  });

  describe('normalizeTimestamp (DMY)', () => {
    it('parses DD/MM/YYYY to UTC ISO at midnight', () => {
      expect(normalizeTimestamp('24/03/2026', 'dmy')).toBe('2026-03-24T00:00:00.000Z');
    });

    it('zero-pads single-digit day/month', () => {
      expect(normalizeTimestamp('5/4/2026', 'dmy')).toBe('2026-04-05T00:00:00.000Z');
    });

    it('returns null for empty', () => {
      expect(normalizeTimestamp('', 'dmy')).toBeNull();
    });

    it('returns null for unparseable DMY', () => {
      expect(normalizeTimestamp('garbage', 'dmy')).toBeNull();
      expect(normalizeTimestamp('30/30/2026', 'dmy')).toBeNull();
    });
  });

  describe('normalizeTimestamp (auto-detect — mixed formats in same row)', () => {
    it('auto-detects ISO and DMY independently', () => {
      // CI-3 scenario: fecha_publicacion (ISO) + fecha_inicio (DMY) in one row.
      expect(normalizeTimestamp('2026-03-23 20:33:39')).toBe('2026-03-23T20:33:39.000Z');
      expect(normalizeTimestamp('17/03/2026')).toBe('2026-03-17T00:00:00.000Z');
    });
  });

  describe('normalizeDateOnly (for date columns)', () => {
    it('returns YYYY-MM-DD from a DMY value', () => {
      expect(normalizeDateOnly('24/03/2026', 'dmy')).toBe('2026-03-24');
    });

    it('returns YYYY-MM-DD from an ISO value', () => {
      expect(normalizeDateOnly('2026-03-23 20:33:39', 'iso')).toBe('2026-03-23');
    });

    it('returns null for empty', () => {
      expect(normalizeDateOnly('', 'dmy')).toBeNull();
    });
  });
});
