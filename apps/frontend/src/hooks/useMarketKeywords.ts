import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_MARKET_KEYWORDS } from '@tecnolicity/shared';

/**
 * Market segment keyword state for the Market Intelligence page (PR6).
 *
 * - Initial value: keywords from the `?segment=` URL param, else the
 *   localStorage override, else {@link DEFAULT_MARKET_KEYWORDS}.
 * - Edits are persisted to `localStorage` so the user's custom keyword set
 *   survives reloads. The set is NOT pushed to the URL on every keystroke (only
 *   the committed "Analizar" snapshot is) to keep the URL readable.
 *
 * Returns the LIVE keyword list (edits), plus a `committed` snapshot used as the
 * query key, and helpers to add/remove/commit/reset.
 */
const STORAGE_KEY = 'tecnolicity.market.keywords';

function readStored(): string[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((k): k is string => typeof k === 'string' && k.trim().length > 0);
  } catch {
    return null;
  }
}

function readUrlSegment(): string[] | null {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('segment');
  if (!raw) return null;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function useMarketKeywords() {
  const [keywords, setKeywords] = useState<string[]>(() => {
    if (typeof window === 'undefined') return [...DEFAULT_MARKET_KEYWORDS];
    return readUrlSegment() ?? readStored() ?? [...DEFAULT_MARKET_KEYWORDS];
  });
  // The snapshot actually queried. Starts equal to keywords so the first render
  // already fires the queries (no mandatory "Analizar" click to see data).
  const [committed, setCommitted] = useState<string[]>(keywords);

  // Persist live edits to localStorage (debounced naturally by React batching).
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(keywords));
    } catch {
      /* storage full / disabled — non-fatal */
    }
  }, [keywords]);

  const add = useCallback((kw: string) => {
    const clean = kw.trim().replace(/\s+/g, ' ');
    if (!clean) return;
    setKeywords((prev) =>
      prev.some((k) => k.toLowerCase() === clean.toLowerCase()) ? prev : [...prev, clean],
    );
  }, []);

  const remove = useCallback((kw: string) => {
    setKeywords((prev) => prev.filter((k) => k !== kw));
  }, []);

  const commit = useCallback(() => {
    setCommitted(keywords);
    // Reflect the committed set in the URL (shareable).
    const params = new URLSearchParams(window.location.search);
    params.set('segment', keywords.join(','));
    window.history.replaceState(null, '', `?${params.toString()}`);
  }, [keywords]);

  const reset = useCallback(() => {
    setKeywords([...DEFAULT_MARKET_KEYWORDS]);
  }, []);

  const clear = useCallback(() => {
    setKeywords([]);
  }, []);

  return { keywords, committed, add, remove, commit, reset, clear };
}
