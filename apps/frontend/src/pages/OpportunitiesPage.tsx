import { useState, type FormEvent } from 'react';
import { differenceInCalendarDays, isValid, parseISO } from 'date-fns';
import { useVigentes, useScrapeVigentes } from '../api/queries';
import type { VigenteItem } from '../types';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorBanner,
  Skeleton,
  Spinner,
} from '../components/ui';
import { Pagination } from '../components/Pagination';

const PAGE_SIZE = 20;

const TIPO_OPTIONS = [
  'ADQUISICIONES',
  'SERVICIOS',
  'OBRA PÚBLICA',
  'SERVICIOS RELACIONADOS CON LA OBRA',
  'ARRENDAMIENTOS',
] as const;

const PROCEDIMIENTO_OPTIONS = [
  'LICITACIÓN PÚBLICA',
  'ADJUDICACIÓN DIRECTA',
  'INVITACIÓN A CUANDO MENOS TRES PERSONAS',
] as const;

/** Quick-preset keyword groups for common market segments. */
const SEGMENT_PRESETS: { label: string; keywords: string }[] = [
  { label: 'Software & TI', keywords: 'software,licencia,sistema,computo,servidor,red,informatica' },
  { label: 'Cámaras & Seguridad', keywords: 'camara,cctv,videovigilancia,seguridad,control de acceso' },
  { label: 'Equipos', keywords: 'equipo,computo,electronico,comunicacion,radiocomunicacion' },
];

/** Days until the bid deadline. Null when the date is missing/invalid. */
function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const d = parseISO(iso);
  return isValid(d) ? differenceInCalendarDays(d, new Date()) : null;
}

/** Color-coded urgency for the deadline pill. */
function urgencyTone(days: number | null): 'warning' | 'neutral' | 'success' {
  if (days === null) return 'neutral';
  if (days < 7) return 'warning'; // red-ish (< 7 days) — uses warning as the hot tone
  if (days < 30) return 'neutral'; // amber-ish (< 30 days)
  return 'success'; // green (> 30 days)
}

function deadlineLabel(days: number | null): string {
  if (days === null) return 'Sin fecha';
  if (days < 0) return 'Cerrado';
  if (days === 0) return 'Hoy';
  if (days === 1) return 'Mañana';
  return `${days} días`;
}

/**
 * Oportunidades — currently-open procurement procedures scraped live from
 * ComprasMX ("Anuncios vigentes"). Sorted by bid deadline (most urgent first);
 * each row shows the days remaining, color-coded.
 *
 * The "Actualizar datos" button triggers a live scrape (POST /vigentes/scrape),
 * which runs Playwright against ComprasMX (~50s for ~1.1k rows).
 */
export function OpportunitiesPage() {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [tipoContratacion, setTipoContratacion] = useState('');
  const [tipoProcedimiento, setTipoProcedimiento] = useState('');
  const [dependencia, setDependencia] = useState('');
  const [applied, setApplied] = useState<{
    q: string;
    tipo: string;
    proc: string;
    dep: string;
  }>({ q: '', tipo: '', proc: '', dep: '' });

  const vigentes = useVigentes({
    page,
    page_size: PAGE_SIZE,
    q: applied.q || undefined,
    tipo_contratacion: applied.tipo || undefined,
    tipo_procedimiento: applied.proc || undefined,
    dependencia: applied.dep || undefined,
  });

  const scrape = useScrapeVigentes();

  function applyFilters(e: FormEvent) {
    e.preventDefault();
    setApplied({ q: q.trim(), tipo: tipoContratacion, proc: tipoProcedimiento, dep: dependencia.trim() });
    setPage(1);
  }

  function clearFilters() {
    setQ('');
    setTipoContratacion('');
    setTipoProcedimiento('');
    setDependencia('');
    setApplied({ q: '', tipo: '', proc: '', dep: '' });
    setPage(1);
  }

  function applyPreset(keywords: string) {
    setQ(keywords);
    setApplied((prev) => ({ ...prev, q: keywords }));
    setPage(1);
  }

  const total = vigentes.data?.pagination.total ?? 0;
  const totalPages = vigentes.data?.pagination.total_pages ?? 0;
  const hasFilters = applied.q || applied.tipo || applied.proc || applied.dep;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Oportunidades vigentes</h1>
          <p className="text-sm text-slate-500">
            Procedimientos <strong>actualmente abiertos para licitar</strong> en ComprasMX. Datos
            actualizados bajo demanda.
          </p>
        </div>
        <Button
          type="button"
          onClick={() => scrape.mutate()}
          disabled={scrape.isPending}
        >
          {scrape.isPending ? (
            <>
              <Spinner className="h-4 w-4" /> Actualizando…
            </>
          ) : (
            '↻ Actualizar datos'
          )}
        </Button>
      </div>

      {scrape.isError ? (
        <ErrorBanner
          message="No se pudo actualizar desde ComprasMX. Intentá nuevamente."
          onRetry={() => scrape.mutate()}
        />
      ) : null}

      {scrape.data ? (
        <ScrapeResultBanner
          status={scrape.data.status}
          found={scrape.data.found}
          inserted={scrape.data.inserted}
          updated={scrape.data.updated}
          totalReported={scrape.data.totalReported}
          pages={scrape.data.pagesScraped}
          message={scrape.data.message}
        />
      ) : null}

      <Card>
        <CardHeader
          title="Filtros"
          subtitle={`${total.toLocaleString('es-MX')} procedimiento${total === 1 ? '' : 's'} vigente${total === 1 ? '' : 's'}${hasFilters ? ' (filtrados)' : ''}`}
        />
        <form
          onSubmit={applyFilters}
          className="space-y-3 px-5 py-4"
        >
          {/* Quick presets */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-slate-500">Acceso rápido:</span>
            {SEGMENT_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => applyPreset(preset.keywords)}
                className="rounded-full bg-institucional-50 px-3 py-1 text-xs font-medium text-institucional-700 ring-1 ring-inset ring-institucional-200 transition hover:bg-institucional-100"
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-slate-600">
                Palabras clave <span className="text-slate-400">(separadas por coma)</span>
              </span>
              <input
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="software, camara, CCTV…"
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-institucional focus:outline-none focus:ring-1 focus:ring-institucional"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-slate-600">Tipo de contratación</span>
              <select
                value={tipoContratacion}
                onChange={(e) => setTipoContratacion(e.target.value)}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-institucional focus:outline-none focus:ring-1 focus:ring-institucional"
              >
                <option value="">Todas</option>
                {TIPO_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-slate-600">Tipo de procedimiento</span>
              <select
                value={tipoProcedimiento}
                onChange={(e) => setTipoProcedimiento(e.target.value)}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-institucional focus:outline-none focus:ring-1 focus:ring-institucional"
              >
                <option value="">Todos</option>
                {PROCEDIMIENTO_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-slate-600">Dependencia (siglas)</span>
              <input
                type="text"
                value={dependencia}
                onChange={(e) => setDependencia(e.target.value)}
                placeholder="IMSS, SICT, CONAGUA…"
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-institucional focus:outline-none focus:ring-1 focus:ring-institucional"
              />
            </label>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="submit" variant="primary">
              Aplicar filtros
            </Button>
            <Button type="button" variant="secondary" onClick={clearFilters}>
              Limpiar
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        {vigentes.isLoading ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : vigentes.isError ? (
          <ErrorBanner message="No se pudieron cargar los procedimientos vigentes." />
        ) : total === 0 ? (
          <EmptyState
            title="Sin procedimientos vigentes"
            hint={
              hasFilters
                ? 'Probá ajustar los filtros.'
                : 'Ejecutá "Actualizar datos" para descargar los vigentes desde ComprasMX.'
            }
          />
        ) : (
          <VigentesTable rows={vigentes.data?.data ?? []} />
        )}
        <div className="border-t border-slate-200 px-5 py-3">
          <Pagination page={page} totalPages={totalPages} total={total} onPage={setPage} />
        </div>
      </Card>
    </div>
  );
}

function VigentesTable({ rows }: { rows: VigenteItem[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <th className="px-5 py-3">Procedimiento</th>
            <th className="px-5 py-3">Dependencia</th>
            <th className="px-5 py-3">Tipo</th>
            <th className="px-5 py-3">Presentación</th>
            <th className="px-5 py-3 text-right">Días restantes</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => {
            const days = daysUntil(r.fecha_presentacion_apertura);
            return (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="px-5 py-3 align-top">
                  <div className="font-medium text-slate-900">
                    {r.direcciones_anuncio ? (
                      <a
                        href={r.direcciones_anuncio}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-institucional hover:underline"
                      >
                        {r.numero_procedimiento} ↗
                      </a>
                    ) : (
                      r.numero_procedimiento
                    )}
                  </div>
                  <div className="mt-0.5 line-clamp-2 max-w-md text-xs text-slate-500">
                    {r.nombre ?? '(sin nombre)'}
                  </div>
                </td>
                <td className="px-5 py-3 align-top">
                  <Badge tone="info">{r.siglas_dependencia ?? '—'}</Badge>
                  <div className="mt-1 text-xs text-slate-400">{r.entidad_federativa ?? ''}</div>
                </td>
                <td className="px-5 py-3 align-top">
                  <div className="text-slate-700">{r.tipo_contratacion ?? '—'}</div>
                  <div className="text-xs text-slate-400">{r.tipo_procedimiento ?? ''}</div>
                </td>
                <td className="px-5 py-3 align-top text-slate-700">
                  {formatDate(r.fecha_presentacion_apertura)}
                </td>
                <td className="px-5 py-3 text-right align-top">
                  <Badge tone={urgencyTone(days)}>{deadlineLabel(days)}</Badge>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = parseISO(iso);
  if (!isValid(d)) return '—';
  // Display in America/Mexico_City time (the stored instant is already UTC-correct).
  return d.toLocaleString('es-MX', {
    timeZone: 'America/Mexico_City',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function ScrapeResultBanner(props: {
  status: string;
  found: number;
  inserted: number;
  updated: number;
  totalReported: number | null;
  pages: number;
  message?: string;
}) {
  if (props.status === 'ok') {
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        <span>
          <strong>{props.found.toLocaleString('es-MX')}</strong> vigentes encontrados
          {props.totalReported !== null ? ` de ${props.totalReported.toLocaleString('es-MX')} reportados` : ''}
          {' · '}
          {props.pages} página{props.pages === 1 ? '' : 's'}
        </span>
        <span>
          <strong>{props.inserted}</strong> nuevos · <strong>{props.updated}</strong> actualizados
        </span>
      </div>
    );
  }
  return (
    <ErrorBanner
      message={props.message ?? 'No se pudo completar la actualización desde ComprasMX.'}
    />
  );
}
