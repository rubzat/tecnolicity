import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardHeader, Badge, Button, ErrorBanner, Skeleton, Spinner, EmptyState } from '../components/ui';
import { useMarketKeywords } from '../hooks/useMarketKeywords';
import { useIsMobile } from '../hooks/useIsMobile';
import { ScrollShadowX } from '../components/ScrollShadowX';
import {
  useMarketOverview,
  useMarketCompetitors,
  useMarketBuyers,
  useMarketOpportunities,
  useMarketExpiring,
  useMarketDominance,
  useVigentes,
} from '../api/queries';
import { formatCurrency, formatCurrencyCompact, formatNumber, formatDate } from '../utils/format';
import type {
  MarketCompetitor,
  MarketBuyer,
  MarketOpportunity,
  MarketExpiringContract,
  MarketDominance,
  VigenteItem,
} from '../types';

const CHART_HEIGHT = 300;
const CHART_PALETTE = ['#611232', '#872240', '#a93853', '#cd5a78', '#e08aa5', '#3a0b1f', '#5a1530', '#7b1e3e', '#9c2a4c', '#bf3f64'];
const tooltipStyle = { borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' } as const;

/**
 * Page 4: Market Intelligence (PR6). Lets the user define a market segment via
 * keywords and explore competitors, buyers, opportunities, expiring contracts,
 * and supplier dominance — all scoped to that segment.
 */
export function MarketPage() {
  const { keywords, committed, add, remove, commit, reset, clear } = useMarketKeywords();
  const [draft, setDraft] = useState('');

  // All queries use the COMMITTED keyword snapshot; editing chips doesn't refire
  // until the user hits "Analizar".
  const overview = useMarketOverview(committed, true);
  const competitors = useMarketCompetitors(committed, true, 10);
  const buyers = useMarketBuyers(committed, true, 10);
  const opportunities = useMarketOpportunities(committed, true, 1, 20);
  const expiring = useMarketExpiring(committed, true, 6, 20);
  const dominance = useMarketDominance(committed, true, 10);

  // Vigente procedures currently open on ComprasMX, filtered to this segment's
  // keywords. Independent of the historical `opportunities` snapshot above:
  // these are bids you can STILL submit to right now.
  const vigentes = useVigentes({
    page: 1,
    page_size: 10,
    q: committed.length > 0 ? committed.join(' ') : undefined,
  });

  const hasError =
    overview.isError ||
    competitors.isError ||
    buyers.isError ||
    opportunities.isError ||
    expiring.isError ||
    dominance.isError;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-xl font-semibold text-slate-900">Mercado</h1>
        <p className="text-sm text-slate-500">
          Explorá competidores, compradores y oportunidades en tu segmento de negocio.
        </p>
      </div>

      {/* ── Segment selector ── */}
      <Card>
        <CardHeader
          title="Inteligencia de Mercado"
          subtitle="Define tu segmento por palabras clave (software, cámara, seguridad…)"
          action={
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" type="button" onClick={clear}>
                Limpiar
              </Button>
              <Button variant="ghost" size="sm" type="button" onClick={reset}>
                Restablecer
              </Button>
            </div>
          }
        />
        <div className="space-y-3 p-4">
          <div className="flex flex-wrap gap-2">
            {keywords.length === 0 && (
              <span className="text-sm text-slate-400">
                Sin palabras clave. Añade al menos una para analizar.
              </span>
            )}
            {keywords.map((kw) => (
              <span
                key={kw}
                className="inline-flex items-center gap-1 rounded-full bg-institucional-50 px-2.5 py-1 text-xs font-medium text-institucional-700 ring-1 ring-inset ring-institucional-200"
              >
                {kw}
                <button
                  type="button"
                  aria-label={`Quitar ${kw}`}
                  onClick={() => remove(kw)}
                  className="ml-0.5 rounded-full text-institucional-400 hover:text-institucional-700"
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && draft.trim()) {
                  add(draft);
                  setDraft('');
                }
              }}
              placeholder="Añadir palabra clave y pulsar Enter…"
              className="min-w-[14rem] flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-institucional focus:outline-none focus:ring-1 focus:ring-institucional"
            />
            <Button
              variant="secondary"
              size="md"
              type="button"
              disabled={!draft.trim()}
              onClick={() => {
                if (draft.trim()) {
                  add(draft);
                  setDraft('');
                }
              }}
            >
              Añadir
            </Button>
            <Button type="button" onClick={commit}>
              Analizar
            </Button>
          </div>
          <p className="text-xs text-slate-400">
            {committed.length} palabras activas · coincidence insensible a mayúsculas y acentos (variante con/sin acento recomendada)
          </p>
        </div>
      </Card>

      {hasError && (
        <ErrorBanner message="Error al cargar el análisis de mercado. Revisa la conexión e inténtalo de nuevo." />
      )}

      {/* ── Overview cards + trend ── */}
      <section className="space-y-3">
        <OverviewCards loading={overview.isLoading} data={overview.data} />
        <Card>
          <CardHeader title="Tamaño del mercado por año" subtitle="Monto adjudicado (MXN) por año" />
          <div className="p-4">
            <TrendChart loading={overview.isLoading} data={overview.data?.by_year ?? []} />
          </div>
        </Card>
      </section>

      {/* ── Competidores ── */}
      <Card>
        <CardHeader title="Top competidores" subtitle="Proveedores por monto en el segmento" />
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="p-4">
            <RankedBarChart
              loading={competitors.isLoading}
              rows={competitors.data?.data ?? []}
              nameKey="nombre"
              valueKey="total_amount"
            />
          </div>
          <CompetitorsTable loading={competitors.isLoading} rows={competitors.data?.data ?? []} />
        </div>
      </Card>

      {/* ── Compradores ── */}
      <Card>
        <CardHeader title="Top compradores" subtitle="Dependencias por gasto en el segmento" />
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="p-4">
            <RankedBarChart
              loading={buyers.isLoading}
              rows={buyers.data?.data ?? []}
              nameKey="nombre"
              valueKey="total_amount"
            />
          </div>
          <BuyersTable loading={buyers.isLoading} rows={buyers.data?.data ?? []} />
        </div>
      </Card>

      {/* ── Oportunidades ACTUALMENTE abiertas (vigentes en vivo) ── */}
      <Card>
        <CardHeader
          title="Oportunidades actualmente abiertas"
          subtitle="Procedimientos ACTUALMENTE abiertos para licitar en ComprasMX (vigentes en vivo)"
          action={
            <Link to="/oportunidades" className="text-xs font-medium text-institucional hover:underline">
              Ver todas →
            </Link>
          }
        />
        <VigenteOpportunitiesTable loading={vigentes.isLoading} rows={vigentes.data?.data ?? []} />
      </Card>

      {/* ── Oportunidades (histórico reciente) ── */}
      <Card>
        <CardHeader
          title="Oportunidades"
          subtitle="Procedimientos abiertos recientemente (últimos 90 días) en el segmento — vista histórica"
        />
        <OpportunitiesTable loading={opportunities.isLoading} rows={opportunities.data?.data ?? []} />
      </Card>

      {/* ── Contratos por vencer ── */}
      <Card>
        <CardHeader title="Contratos por vencer" subtitle="Renovaciones próximas (próximos 6 meses)" />
        <ExpiringTable loading={expiring.isLoading} rows={expiring.data?.data ?? []} />
      </Card>

      {/* ── Dominancia ── */}
      <Card>
        <CardHeader
          title="Análisis de dominancia"
          subtitle="Dependencias donde un proveedor concentra el mercado (≥ 60%)"
        />
        <DominanceTable loading={dominance.isLoading} rows={dominance.data?.data ?? []} />
      </Card>
    </div>
  );
}

// ─── Overview cards ────────────────────────────────────────────────────────

function OverviewCards({ loading, data }: { loading: boolean; data: import('../types').MarketOverview | undefined }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Metric label="Tamaño del mercado" loading={loading} value={data ? formatCurrencyCompact(data.total_amount) : '—'} />
      <Metric label="Contratos" loading={loading} value={data ? formatNumber(data.total_contracts) : '—'} />
      <Metric label="Proveedores únicos" loading={loading} value={data ? formatNumber(data.unique_suppliers) : '—'} />
      <Metric label="Compradores únicos" loading={loading} value={data ? formatNumber(data.unique_buyers) : '—'} />
    </div>
  );
}

function Metric({ label, value, loading }: { label: string; value: string; loading: boolean }) {
  return (
    <Card className="px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      {loading ? (
        <Skeleton className="mt-1.5 h-6 w-24" />
      ) : (
        <div className="mt-1 text-xl font-semibold text-slate-900">{value}</div>
      )}
    </Card>
  );
}

// ─── Trend chart ───────────────────────────────────────────────────────────

function TrendChart({ loading, data }: { loading: boolean; data: { year: number; amount: number }[] }) {
  if (loading) return <ChartLoading />;
  if (data.length === 0) return <EmptyState title="Sin datos de tendencia" />;
  const chartData = data.map((d) => ({ name: String(d.year), value: d.amount }));
  return (
    <div style={{ width: '100%', height: CHART_HEIGHT }}>
      <ResponsiveContainer>
        <BarChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="name" tick={{ fontSize: 12 }} stroke="#94a3b8" />
          <YAxis tickFormatter={(v: number) => formatCurrencyCompact(v)} tick={{ fontSize: 11 }} stroke="#94a3b8" />
          <Tooltip formatter={(v) => formatCurrency(Number(v))} contentStyle={tooltipStyle} />
          <Bar dataKey="value" name="Monto" radius={[4, 4, 0, 0]} fill={CHART_PALETTE[0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Ranked horizontal bar chart ───────────────────────────────────────────

function RankedBarChart<T>({
  loading,
  rows,
  nameKey,
  valueKey,
}: {
  loading: boolean;
  rows: T[];
  nameKey: keyof T & string;
  valueKey: keyof T & string;
}) {
  const isMobile = useIsMobile();
  if (loading) return <ChartLoading />;
  if (rows.length === 0) return <EmptyState title="Sin datos para este segmento" />;
  const data = rows.map((r) => {
    const row = r as Record<string, unknown>;
    return { name: truncate(String(row[nameKey] ?? '—'), isMobile ? 16 : 32), value: Number(row[valueKey] ?? 0) };
  });
  return (
    <div style={{ width: '100%', height: CHART_HEIGHT }}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis type="number" tickFormatter={(v: number) => formatCurrencyCompact(v)} tick={{ fontSize: 11 }} stroke="#94a3b8" />
          <YAxis
            type="category"
            dataKey="name"
            width={isMobile ? 84 : 130}
            tick={{ fontSize: isMobile ? 9 : 10 }}
            stroke="#94a3b8"
          />
          <Tooltip formatter={(v) => formatCurrency(Number(v))} contentStyle={tooltipStyle} />
          <Bar dataKey="value" name="Monto" radius={[0, 4, 4, 0]}>
            {data.map((_, i) => (
              <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Competitors table ─────────────────────────────────────────────────────

function CompetitorsTable({ loading, rows }: { loading: boolean; rows: MarketCompetitor[] }) {
  if (loading) return <TableSkeleton cols={5} />;
  if (rows.length === 0) return <EmptyState title="Sin competidores para este segmento" />;
  return (
    <TableWrap>
      <thead className="bg-slate-50">
        <tr>
          <Th>Proveedor</Th>
          <Th right>Contratos</Th>
          <Th right>Monto total</Th>
          <Th right>% participación</Th>
          <Th right>Agencias</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map((r) => (
          <tr key={r.rfc} className="hover:bg-institucional-50/40">
            <Td>
              <span className="font-medium text-slate-900">{truncate(r.nombre, 48)}</span>
              <span className="block text-xs text-slate-400">{r.rfc}</span>
            </Td>
            <Td right>{formatNumber(r.contracts_count)}</Td>
            <Td right>{formatCurrency(r.total_amount)}</Td>
            <Td right>
              <Badge tone={r.market_share_pct >= 10 ? 'institucional' : 'neutral'}>
                {r.market_share_pct.toFixed(2)}%
              </Badge>
            </Td>
            <Td right>{formatNumber(r.unique_buyers)}</Td>
          </tr>
        ))}
      </tbody>
    </TableWrap>
  );
}

// ─── Buyers table ──────────────────────────────────────────────────────────

function BuyersTable({ loading, rows }: { loading: boolean; rows: MarketBuyer[] }) {
  if (loading) return <TableSkeleton cols={5} />;
  if (rows.length === 0) return <EmptyState title="Sin compradores para este segmento" />;
  return (
    <TableWrap>
      <thead className="bg-slate-50">
        <tr>
          <Th>Dependencia</Th>
          <Th right>Contratos</Th>
          <Th right>Monto total</Th>
          <Th right>Proveedores</Th>
          <Th>Proveedor dominante</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map((r) => (
          <tr key={r.clave} className="hover:bg-institucional-50/40">
            <Td>
              <span className="font-medium text-slate-900">{truncate(r.nombre, 44)}</span>
            </Td>
            <Td right>{formatNumber(r.contracts_count)}</Td>
            <Td right>{formatCurrency(r.total_amount)}</Td>
            <Td right>{formatNumber(r.unique_suppliers)}</Td>
            <Td>
              {r.top_supplier ? (
                <div className="text-xs">
                  <span className="text-slate-700">{truncate(r.top_supplier.nombre, 30)}</span>
                  <Badge tone="info" className="ml-1">
                    {r.top_supplier.market_share_pct.toFixed(1)}%
                  </Badge>
                </div>
              ) : (
                <span className="text-slate-300">—</span>
              )}
            </Td>
          </tr>
        ))}
      </tbody>
    </TableWrap>
  );
}

// ─── Opportunities table ───────────────────────────────────────────────────

function OpportunitiesTable({ loading, rows }: { loading: boolean; rows: MarketOpportunity[] }) {
  if (loading) return <TableSkeleton cols={6} />;
  if (rows.length === 0)
    return <EmptyState title="Sin oportunidades recientes" hint="No hay procedimientos abiertos en los últimos 90 días para este segmento." />;
  return (
    <TableWrap>
      <thead className="bg-slate-50">
        <tr>
          <Th>Procedimiento</Th>
          <Th>Descripción</Th>
          <Th>Dependencia</Th>
          <Th>Apertura</Th>
          <Th right>Monto est.</Th>
          <Th>Estatus</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map((r) => (
          <tr key={r.numero_procedimiento} className="hover:bg-institucional-50/40">
            <Td>
              <Link
                to={`/procedimientos/${encodeURIComponent(r.numero_procedimiento)}`}
                className="font-medium text-institucional hover:underline"
              >
                {r.numero_procedimiento}
              </Link>
            </Td>
            <Td>
              <span className="text-xs text-slate-600">{truncate(r.descripcion ?? '—', 60)}</span>
            </Td>
            <Td>
              <span className="text-xs text-slate-700">{truncate(r.institucion_nombre, 30)}</span>
            </Td>
            <Td>
              <span className="text-xs text-slate-600">{formatDate(r.fecha_apertura)}</span>
            </Td>
            <Td right>
              <span className="text-xs">{formatCurrency(r.importe_estimado)}</span>
            </Td>
            <Td>
              <Badge tone={r.fecha_fallo ? 'neutral' : 'info'}>
                {r.fecha_fallo ? 'Adjudicado' : 'En proceso'}
              </Badge>
            </Td>
          </tr>
        ))}
      </tbody>
    </TableWrap>
  );
}

// ─── Vigente (currently-open) opportunities table ──────────────────────────

/** Whole days from now until an ISO deadline (negative if past, null if none). */
function daysUntilDeadline(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - Date.now()) / 86_400_000);
}

function vigenteUrgencyClass(days: number | null): string {
  if (days === null) return 'bg-slate-100 text-slate-600 ring-slate-200';
  if (days < 0) return 'bg-slate-100 text-slate-500 ring-slate-200';
  if (days < 7) return 'bg-red-50 text-red-700 ring-red-200'; // < 7 days: hot
  if (days < 30) return 'bg-amber-50 text-amber-700 ring-amber-200'; // < 30 days
  return 'bg-emerald-50 text-emerald-700 ring-emerald-200'; // > 30 days
}

function vigenteDeadlineLabel(days: number | null): string {
  if (days === null) return 'Sin fecha';
  if (days < 0) return 'Cerrado';
  if (days === 0) return 'Hoy';
  if (days === 1) return 'Mañana';
  return `${days} días`;
}

function VigenteOpportunitiesTable({ loading, rows }: { loading: boolean; rows: VigenteItem[] }) {
  if (loading) return <TableSkeleton cols={4} />;
  if (rows.length === 0)
    return (
      <EmptyState
        title="Sin oportunidades vigentes"
        hint="No hay procedimientos abiertos para licitar que coincidan con este segmento."
      />
    );
  return (
    <TableWrap>
      <thead className="bg-slate-50">
        <tr>
          <Th>Procedimiento</Th>
          <Th>Dependencia</Th>
          <Th>Tipo</Th>
          <Th>Cierre</Th>
          <Th right>Días</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map((r) => {
          const days = daysUntilDeadline(r.fecha_presentacion_apertura);
          return (
            <tr key={r.id} className="hover:bg-institucional-50/40">
              <Td>
                {r.direcciones_anuncio ? (
                  <a
                    href={r.direcciones_anuncio}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="font-medium text-institucional hover:underline"
                  >
                    {r.numero_procedimiento} ↗
                  </a>
                ) : (
                  <span className="font-medium text-slate-700">{r.numero_procedimiento}</span>
                )}
                <div className="text-xs text-slate-400">{truncate(r.nombre ?? '', 60)}</div>
              </Td>
              <Td>
                <Badge tone="info">{r.siglas_dependencia ?? '—'}</Badge>
              </Td>
              <Td>
                <span className="text-xs text-slate-600">{r.tipo_contratacion ?? '—'}</span>
              </Td>
              <Td>
                <span className="text-xs text-slate-600">{formatDate(r.fecha_presentacion_apertura)}</span>
              </Td>
              <Td right>
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${vigenteUrgencyClass(days)}`}
                >
                  {vigenteDeadlineLabel(days)}
                </span>
              </Td>
            </tr>
          );
        })}
      </tbody>
    </TableWrap>
  );
}

// ─── Expiring contracts table ──────────────────────────────────────────────

function expiringTone(daysLeft: number): 'danger' | 'warning' | 'success' {
  if (daysLeft < 30) return 'danger';
  if (daysLeft < 90) return 'warning';
  return 'success';
}

function ExpiringTable({ loading, rows }: { loading: boolean; rows: MarketExpiringContract[] }) {
  const now = useMemo(() => Date.now(), []);
  if (loading) return <TableSkeleton cols={5} />;
  if (rows.length === 0) return <EmptyState title="Sin contratos por vencer" />;
  return (
    <TableWrap>
      <thead className="bg-slate-50">
        <tr>
          <Th>Contrato</Th>
          <Th>Proveedor actual</Th>
          <Th>Dependencia</Th>
          <Th right>Monto</Th>
          <Th>Vence en</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map((r) => {
          const daysLeft = r.fecha_fin ? Math.ceil((new Date(r.fecha_fin).getTime() - now) / 86_400_000) : null;
          const tone = daysLeft == null ? null : expiringTone(daysLeft);
          return (
            <tr key={r.contrato_id} className="hover:bg-institucional-50/40">
              <Td>
                <Link
                  to={`/procedimientos/${encodeURIComponent(r.numero_procedimiento)}`}
                  className="font-medium text-institucional hover:underline"
                >
                  {r.numero_contrato ?? `#${r.contrato_id}`}
                </Link>
                <span className="block text-xs text-slate-400">{truncate(r.titulo ?? '—', 40)}</span>
              </Td>
              <Td>
                <span className="text-xs text-slate-700">{r.supplier ? truncate(r.supplier.nombre, 28) : '—'}</span>
              </Td>
              <Td>
                <span className="text-xs text-slate-700">{truncate(r.institucion_nombre, 28)}</span>
              </Td>
              <Td right>
                <span className="text-xs">{formatCurrency(r.importe_drc)}</span>
              </Td>
              <Td>
                {daysLeft == null ? (
                  <span className="text-slate-300">—</span>
                ) : (
                  <span
                    className={
                      tone === 'danger'
                        ? 'text-sm font-semibold text-red-600'
                        : tone === 'warning'
                          ? 'text-sm font-semibold text-amber-600'
                          : 'text-sm font-medium text-emerald-600'
                    }
                  >
                    {formatDate(r.fecha_fin)} · {daysLeft}d
                  </span>
                )}
              </Td>
            </tr>
          );
        })}
      </tbody>
    </TableWrap>
  );
}

// ─── Dominance table ───────────────────────────────────────────────────────

function dominanceTone(pct: number): 'danger' | 'warning' | 'success' {
  if (pct >= 80) return 'danger';
  if (pct >= 60) return 'warning';
  return 'success';
}

function dominanceLabel(pct: number): string {
  if (pct >= 80) return 'Puerta cerrada';
  if (pct >= 60) return 'Difícil';
  return 'Mercado abierto';
}

function DominanceTable({ loading, rows }: { loading: boolean; rows: MarketDominance[] }) {
  if (loading) return <TableSkeleton cols={5} />;
  if (rows.length === 0)
    return <EmptyState title="Mercado atomizado" hint="Ninguna dependencia tiene un proveedor con ≥ 60% del segmento: mercado competitivo." />;
  return (
    <TableWrap>
      <thead className="bg-slate-50">
        <tr>
          <Th>Dependencia</Th>
          <Th>Proveedor dominante</Th>
          <Th right>% dominancia</Th>
          <Th right>Monto total</Th>
          <Th>Acceso</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map((r) => {
          const tone = dominanceTone(r.dominant_share_pct);
          return (
            <tr key={r.institution_clave} className="hover:bg-institucional-50/40">
              <Td>
                <span className="font-medium text-slate-900">{truncate(r.institution_nombre, 40)}</span>
              </Td>
              <Td>
                <span className="text-xs text-slate-700">{truncate(r.dominant_supplier_nombre, 32)}</span>
              </Td>
              <Td right>
                <span
                  className={
                    tone === 'danger'
                      ? 'text-sm font-bold text-red-600'
                      : tone === 'warning'
                        ? 'text-sm font-semibold text-amber-600'
                        : 'text-sm font-medium text-emerald-600'
                  }
                >
                  {r.dominant_share_pct.toFixed(1)}%
                </span>
              </Td>
              <Td right>
                <span className="text-xs">{formatCurrency(r.total_amount)}</span>
              </Td>
              <Td>
                <Badge
                  tone={tone === 'danger' ? 'warning' : tone === 'warning' ? 'info' : 'success'}
                >
                  {dominanceLabel(r.dominant_share_pct)}
                </Badge>
              </Td>
            </tr>
          );
        })}
      </tbody>
    </TableWrap>
  );
}

// ─── Shared table primitives ───────────────────────────────────────────────

function TableWrap({ children }: { children: React.ReactNode }) {
  return (
    <ScrollShadowX>
      <table className="min-w-full divide-y divide-slate-200">{children}</table>
    </ScrollShadowX>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      className={`px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500 ${
        right ? 'text-right' : 'text-left'
      }`}
    >
      {children}
    </th>
  );
}

function Td({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <td className={`px-4 py-2.5 text-sm text-slate-700 ${right ? 'text-right' : 'text-left'}`}>{children}</td>;
}

function ChartLoading() {
  return (
    <div className="grid place-items-center gap-2" style={{ height: CHART_HEIGHT }}>
      <Spinner className="h-5 w-5 text-institucional" />
      <span className="text-xs text-slate-400">Cargando…</span>
    </div>
  );
}

function TableSkeleton({ cols }: { cols: number }) {
  return (
    <div className="p-4">
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
      <span className="sr-only">{cols} columnas</span>
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
