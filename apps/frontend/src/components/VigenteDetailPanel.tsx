import { useEffect } from 'react';
import { isValid, parseISO } from 'date-fns';
import { motion } from 'motion/react';
import { formatCurrency } from '../utils/format';
import {
  useVigenteDetail,
  useFetchVigenteDetail,
} from '../api/queries';
import type { VigenteItem } from '../types';
import {
  extractDetalleFields,
  extractAnexos,
  extractReqEconomicos,
} from '../lib/vigente-detalle';
import {
  Badge,
  Button,
  ErrorBanner,
  Spinner,
} from '../components/ui';
import { backdropVariants, drawerVariants, staggerContainer, staggerItem } from '../lib/motion';

/**
 * VigenteDetailPanel (PR8) — a slide-over drawer showing the FULL detail of a
 * vigente procedure, fetched on-demand from ComprasMX via Playwright.
 *
 * Flow:
 *  - If a cached detail exists → show immediately.
 *  - If not cached → auto-trigger the Playwright fetch (POST /fetch-detail) once,
 *    showing a "Cargando desde Compras MX…" spinner (~8-15s).
 *  - On failure (reCAPTCHA / timeout / no data) → show a graceful message + the
 *    permanent "Ver en Compras MX ↗" fallback link.
 *
 * The table stays visible behind the drawer, so the user can close it (✕ or
 * Escape or backdrop click) and pick another procedure.
 */
export function VigenteDetailPanel({
  procedure,
  onClose,
}: {
  procedure: VigenteItem;
  onClose: () => void;
}) {
  const numero = procedure.numero_procedimiento;
  const detail = useVigenteDetail(numero);
  const fetchDetail = useFetchVigenteDetail(numero);

  const hasCached = Boolean(detail.data?.detalle);
  // Auto-fetch the first time the panel opens for a procedure with no cache.
  useEffect(() => {
    if (!detail.data) return;
    if (detail.data.detalle) return; // already cached
    if (fetchDetail.isPending || fetchDetail.isSuccess || fetchDetail.isError) return;
    if (!procedure.direcciones_anuncio) return;
    fetchDetail.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.data, procedure.direcciones_anuncio]);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Merge: prefer the fetch-mutation response (freshest), else the cached read.
  const payload = fetchDetail.data ?? detail.data;
  const detalle = payload?.detalle ?? null;
  const anexos = payload?.anexos ?? null;
  const reqeconomicos = payload?.reqeconomicos ?? null;
  const fetchedAt = payload?.detalle_fetched_at ?? null;

  const isLoading = fetchDetail.isPending || (!hasCached && detail.isLoading);
  const isFetching = fetchDetail.isPending;

  const { info, fechas } = extractDetalleFields(detalle);
  const { documentos, total: anexosTotal } = extractAnexos(anexos, detalle);
  const reqs = extractReqEconomicos(reqeconomicos, detalle);

  const fetchStatus = fetchDetail.data?.status;
  const isStaleOrFailed =
    fetchStatus === 'stale_failed' ||
    fetchStatus === 'failed' ||
    fetchStatus === 'captcha_blocked' ||
    fetchStatus === 'timeout';

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      {/* Backdrop */}
      <motion.button
        type="button"
        aria-label="Cerrar detalle"
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px]"
        onClick={onClose}
        initial="hidden"
        animate="visible"
        exit="exit"
        variants={backdropVariants}
      />

      {/* Drawer */}
      <motion.aside
        className="relative flex h-full w-full max-w-2xl flex-col bg-slate-50 shadow-2xl"
        initial="hidden"
        animate="visible"
        exit="exit"
        variants={drawerVariants}
      >
        {/* Header */}
        <header className="sticky top-0 z-10 border-b border-slate-200 bg-white px-6 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-base font-semibold text-slate-900">
                  {numero}
                </h2>
                {procedure.estatus ? (
                  <Badge tone="info">{procedure.estatus}</Badge>
                ) : null}
              </div>
              <p className="mt-1 line-clamp-2 text-sm text-slate-600">
                {procedure.nombre ?? '(sin nombre)'}
              </p>
              {fetchedAt ? (
                <p className="mt-1 text-xs text-slate-400">
                  Detalle actualizado {formatRelative(fetchedAt)}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              aria-label="Cerrar"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Permanent fallback: official page link */}
          {procedure.direcciones_anuncio ? (
            <a
              href={procedure.direcciones_anuncio}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-institucional hover:underline"
            >
              Ver en Compras MX ↗
            </a>
          ) : null}
        </header>

        {/* Body */}
        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <Spinner className="h-7 w-7 text-institucional" />
              <p className="text-sm font-medium text-slate-700">
                Cargando detalle desde Compras MX…
              </p>
              <p className="text-xs text-slate-400">
                Esto toma unos segundos la primera vez.
              </p>
            </div>
          ) : isStaleOrFailed && !detalle ? (
            <ErrorBanner
              message={
                fetchDetail.data?.message ??
                'No se pudo cargar el detalle desde Compras MX.'
              }
              onRetry={() => fetchDetail.mutate()}
            />
          ) : detalle ? (
            <motion.div initial="hidden" animate="visible" variants={staggerContainer} className="space-y-5">
              {isStaleOrFailed ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
                  {fetchDetail.data?.message ??
                    'No se pudo refrescar; mostrando datos en caché.'}
                </div>
              ) : null}

              {/* Info grid */}
              {info.length > 0 ? (
                <Section title="Información del procedimiento">
                  <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                    {info.map((f) => (
                      <DetailRow key={f.label} label={f.label} value={f.value} />
                    ))}
                  </dl>
                </Section>
              ) : null}

              {/* Fechas clave */}
              {fechas.some((f) => f.iso) ? (
                <Section title="Fechas clave">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {fechas.map((f) => (
                      <div
                        key={f.label}
                        className="rounded-md border border-slate-200 bg-white px-3 py-2"
                      >
                        <dt className="text-xs font-medium text-slate-500">{f.label}</dt>
                        <dd className="mt-0.5 text-sm text-slate-800">
                          {f.iso ? formatDateTime(f.iso) : '—'}
                        </dd>
                      </div>
                    ))}
                  </div>
                </Section>
              ) : null}

              {/* Documentos adjuntos */}
              <Section
                title="Documentos adjuntos"
                subtitle={
                  anexosTotal !== null && documentos.length < anexosTotal
                    ? `${documentos.length} de ${anexosTotal} (los demás requieren paginar en Compras MX)`
                    : undefined
                }
              >
                {documentos.length === 0 ? (
                  <p className="text-sm text-slate-400">
                    Sin documentos listados.
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {documentos.map((d, i) => (
                      <li
                        key={`${d.descripcion}-${i}`}
                        className="flex items-start gap-2 rounded-md border border-slate-200 bg-white px-3 py-2"
                      >
                        {d.tipo ? (
                          <Badge tone="institucional" className="mt-0.5 shrink-0">
                            {d.tipo}
                          </Badge>
                        ) : null}
                        <span className="text-sm text-slate-700">{d.descripcion}</span>
                        {d.archivos > 0 ? (
                          <span className="ml-auto shrink-0 text-xs text-slate-400">
                            {d.archivos} archivo{d.archivos === 1 ? '' : 's'}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              {/* Requisitos económicos */}
              {reqs.length > 0 ? (
                <Section title="Requisitos económicos">
                  <ul className="space-y-1.5">
                    {reqs.map((r, i) => (
                      <li
                        key={`${r.grupo ?? i}-${i}`}
                        className="rounded-md border border-slate-200 bg-white px-3 py-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium text-slate-700">
                            {r.grupo ?? r.descripcion ?? '(sin nombre)'}
                          </span>
                          {r.total ? (
                            <span className="text-sm text-slate-600">{r.total}</span>
                          ) : null}
                        </div>
                        {r.descripcion && r.descripcion !== r.grupo ? (
                          <p className="mt-0.5 text-xs text-slate-500">{r.descripcion}</p>
                        ) : null}
                        {r.items.length > 0 ? (
                          <ul className="mt-2 space-y-1 border-t border-slate-100 pt-2">
                            {r.items.map((it, j) => (
                              <li
                                key={`${it.claveCucop ?? j}-${j}`}
                                className="flex items-start justify-between gap-2 text-xs"
                              >
                                <span className="text-slate-600">
                                  {it.claveCucop ? (
                                    <span className="mr-1 font-mono text-slate-400">
                                      {it.claveCucop}
                                    </span>
                                  ) : null}
                                  {it.descripcion ?? '(sin descripción)'}
                                  {it.unidadMedida ? (
                                    <span className="text-slate-400"> · {it.unidadMedida}</span>
                                  ) : null}
                                </span>
                                {it.montoMinimo !== null || it.montoMaximo !== null ? (
                                  <span className="shrink-0 whitespace-nowrap text-slate-500">
                                    {formatCurrency(it.montoMinimo)} – {formatCurrency(it.montoMaximo)}
                                  </span>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </Section>
              ) : null}

              {/* Raw JSON expander (for forward-compat / debugging) */}
              <details className="rounded-md border border-slate-200 bg-white px-4 py-2">
                <summary className="cursor-pointer text-xs font-medium text-slate-500">
                  Ver JSON completo (detalle)
                </summary>
                <pre className="mt-2 max-h-64 overflow-auto rounded bg-slate-50 p-3 text-[10px] leading-tight text-slate-600">
                  {JSON.stringify(detalle, null, 2)}
                </pre>
              </details>
            </motion.div>
          ) : (
            <div className="py-10 text-center">
              <p className="text-sm text-slate-500">
                No hay detalle disponible para este procedimiento.
              </p>
              {procedure.direcciones_anuncio ? (
                <a
                  href={procedure.direcciones_anuncio}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="mt-2 inline-block text-sm font-medium text-institucional hover:underline"
                >
                  Ver en Compras MX ↗
                </a>
              ) : null}
            </div>
          )}
        </div>

        {/* Footer */}
        {detalle && !isFetching ? (
          <footer className="border-t border-slate-200 bg-white px-6 py-3">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => fetchDetail.mutate()}
              disabled={fetchDetail.isPending}
            >
              ↻ Refrescar detalle
            </Button>
          </footer>
        ) : null}
      </motion.aside>
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <motion.section variants={staggerItem}>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {subtitle ? <span className="text-xs text-slate-400">{subtitle}</span> : null}
      </div>
      {children}
    </motion.section>
  );
}

function DetailRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-800">{value ?? '—'}</dd>
    </div>
  );
}

/** Format an ISO instant in America/Mexico_City (the source timezone, #231). */
function formatDateTime(iso: string): string {
  const d = parseISO(iso);
  if (!isValid(d)) return iso;
  return d.toLocaleString('es-MX', {
    timeZone: 'America/Mexico_City',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Relative-ish label for a fetched-at timestamp. */
function formatRelative(iso: string): string {
  const d = parseISO(iso);
  if (!isValid(d)) return iso;
  return d.toLocaleString('es-MX', {
    timeZone: 'America/Mexico_City',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
