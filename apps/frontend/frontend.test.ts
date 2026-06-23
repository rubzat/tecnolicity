import { describe, it, expect } from 'vitest';

describe('frontend sanity', () => {
  it('runs vitest', () => {
    expect('frontend'.length).toBe(8);
  });
});
