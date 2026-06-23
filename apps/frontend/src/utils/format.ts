/**
 * Formatting helpers for the portal UI. All currency is MXN pesos; dates are
 * formatted for es-MX locale but rendered as plain YYYY-MM-DD for compactness
 * in tables.
 */

const mxnCurrency = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const mxnCompact = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  notation: 'compact',
  maximumFractionDigits: 1,
});

const mxnNumber = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 });

/** Format a number as MXN pesos. Null/undefined/NaN → '—'. */
export function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return mxnCurrency.format(value);
}

/** Compact peso format for charts and summary cards ($1.2 M). */
export function formatCurrencyCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return mxnCompact.format(value);
}

/** Plain integer with thousands separators (es-MX). */
export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return mxnNumber.format(value);
}

/** Format an ISO date string as DD/MM/YYYY (Mexican convention). Returns '—' when null/invalid. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const year = d.getUTCFullYear();
  return `${day}/${month}/${year}`;
}

/** Format an ISO date+time as DD/MM/YYYY HH:mm. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const date = formatDate(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${date} ${hh}:${mm}`;
}
