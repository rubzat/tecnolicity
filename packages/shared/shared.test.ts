import { describe, it, expect } from 'vitest';
import { paginationSchema, DEFAULT_PAGE_SIZE, DocumentEstatus } from './src/index.js';

describe('shared package', () => {
  it('applies pagination defaults', () => {
    const parsed = paginationSchema.parse({});
    expect(parsed.page).toBe(1);
    expect(parsed.pageSize).toBe(DEFAULT_PAGE_SIZE);
    expect(parsed.sortDir).toBe('asc');
  });

  it('coerces string page params', () => {
    const parsed = paginationSchema.parse({ page: '3', pageSize: '50' });
    expect(parsed.page).toBe(3);
    expect(parsed.pageSize).toBe(50);
  });

  it('rejects pageSize over the cap', () => {
    expect(() => paginationSchema.parse({ pageSize: 999 })).toThrow();
  });

  it('exports document estatus values', () => {
    expect(DocumentEstatus.PENDING).toBe('pending');
    expect(DocumentEstatus.CAPTCHA_BLOCKED).toBe('captcha_blocked');
  });
});
