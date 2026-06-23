import { describe, it, expect } from 'vitest';
import {
  isValidTransition,
  DOCUMENT_ESTATUS,
  type DocumentEstatus,
} from './document-repository.js';

describe('documents.estatus state machine (task 5.4)', () => {
  it('exposes the four legal states', () => {
    expect(DOCUMENT_ESTATUS).toEqual(['pending', 'fetched', 'failed', 'captcha_blocked']);
  });

  it('allows pending → every terminal state', () => {
    const terminals: DocumentEstatus[] = ['fetched', 'failed', 'captcha_blocked'];
    for (const t of terminals) {
      expect(isValidTransition('pending', t)).toBe(true);
    }
  });

  it('forbids jumping between terminal states without retrying via pending', () => {
    // A failed download cannot magically become fetched; it must retry (→pending→fetched).
    expect(isValidTransition('failed', 'fetched')).toBe(false);
    expect(isValidTransition('fetched', 'failed')).toBe(false);
    expect(isValidTransition('captcha_blocked', 'fetched')).toBe(false);
  });

  it('allows retrying a failed / captcha-blocked document via pending', () => {
    expect(isValidTransition('failed', 'pending')).toBe(true);
    expect(isValidTransition('captcha_blocked', 'pending')).toBe(true);
  });

  it('treats fetched→fetched as legal (re-fetch refreshes the cache)', () => {
    expect(isValidTransition('fetched', 'fetched')).toBe(true);
  });

  it('forbids leaving captcha_blocked for anything other than pending', () => {
    expect(isValidTransition('captcha_blocked', 'failed')).toBe(false);
    expect(isValidTransition('captcha_blocked', 'captcha_blocked')).toBe(false);
  });
});
