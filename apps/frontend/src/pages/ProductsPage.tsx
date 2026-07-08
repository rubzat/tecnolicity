import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardHeader, Button, ErrorBanner, Skeleton, Spinner, EmptyState } from '../components/ui';
import { ScrollShadowX } from '../components/ScrollShadowX';
import {
  useProductPriceHistory,
  useProductDistribution,
  useProductSuppliers,
  useProductTopContracts,
} from '../api/queries';
import { formatCurrency, formatCurrencyCompact, formatNumber, formatDate } from '../utils/format';
import type {
  PriceGroupBy,
  PriceHistory,
  PriceDistribution,
  ProductSupplier,
  ProductTopContract,
  TrendDirection,
} from '../types';

const CHART_HEIGHT = 320;
const CHART_PALETTE = ['#611232', '#872240', '#a93853', '#cd5a78', '#e08aa5', '#3a0b1f', '#5a1530', '#7b1e3e', '#9c2a4c', '#bf3f64'];
const tooltipStyle = { borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' } as const;
const TOP_CONTRACTS_PAGE_SIZE = 10;
const SUPPLIERS_LIMIT = 10;

/** Preset keyword sets covering Tecnolicity's commercial focus. */
const PRESETS: { label: string; keywords: string[] }[] = [
  { label: 'Software & Licencias', keywords: ['software', 'licencia', 'sistema', 'aplicación', 'aplicacion'] },
  { label: 'Cámaras & CCTV', keywords: ['cámara', 'camara', 'cctv', 'videovigilancia', 'circuito cerrado'] },
  { label: 'Equipos de cómputo', keywords: ['cómputo', 'computo', 'computadora', 'equipo de cómputo', 'equipo de computo'] },
  { label: 'Servidores & Redes', keywords: ['servidor', 'redes', 'networking', 'base de datos'] },
];

/**
 * Page: Product Price Intelligence (PR10). Lets the user type a comma-separated
 * keyword list (or pick a preset), then explores how much that product class
 * COSTS the government: contract counts, avg/median prices, time evolution,
 * price distribution, who sells it, and the biggest contracts.
 *
 * Mirrors the Market page's commit-on-Analizar pattern: typing alone does not
 * fire requests — the user commits a keyword snapshot first.
 */
export function ProductsPage() {
  const [draft, setDraft] = useState('');
  const [committed, setCommitted] = useState<string[]>([]);
  const [groupBy, setGroupBy] = useState<PriceGroupBy>('year');
  const [topContractsPage, setTopContractsPage] = useState(1);

  const enabled = committed.length > 0;
  const priceHistory = useProductPriceHistory(committed, groupBy, enabled);
  const distribution = useProductDistribution(committed, enabled);
  const suppliers = useProductSuppliers(committed, enabled, SUPPLIERS_LIMIT);
  const topContracts = useProductTopContracts(committed, enabled, topContractsPage, TOP_CONTRACTS_PAGE_SIZE);

  const hasError =
    priceHistory.isError || distribution.isError || suppliers.isError || topContracts.isError;

  function commit() {
    const parsed = parseKeywords(draft);
    if (parsed.length === 0) return;
    setCommitted(parsed);
    setTopContractsPage(1);
  }

  function applyPreset(kws: string[]) {
    setCommitted(kws);
    setDraft(kws.join(', '));
    setTopContractsPage(1);
  }

  return (
    <div className="space-y-6">
      {/* ── Header + search ── */}
      <div>
        <h1 className="font-display text-xl font-semibold text-slate-900">Productos</h1>
        <p className="text-sm text-slate-500">
          Analizá cuánto le cuesta un producto al gobierno: precios, evolución, distribución y proveedores.
        </p>
      </div>

      <Card>
        <CardHeader
          title="Inteligencia de Precios"
          subtitle="Escribí palabras clave separadas por comas (software, licencia, cámara…) o elegí un preset"
        />
        <div className="space-y-3 p-4">
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit();
              }}
              placeholder="software, licencia, sistema…"
              className="min-w-[16rem] flex-1 rounded-md border border-slate-300 px-3 py-2.5 text-sm focus:border-institucional focus:outline-none focus:ring-1 focus:ring-institucional"
            />
            <Button type="button" onClick={commit} disabled={!draft.trim()}>
              Analizar
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Presets:</span>
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => applyPreset(p.keywords)}
                className="rounded-full bg-institucional-50 px-2.5 py-1 text-xs font-medium text-institucional-700 ring-1 ring-inset ring-institucional-200 transition hover:bg-institucional-100"
              >
                {p.label}
              </button>
            ))}
          </div>

          {committed.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-400">
                {committed.length} palabras activas · coincidencia insensible a mayúsculas y acentos
              </span>
              <div className="flex flex-wrap gap-1">
                {committed.map((kw) => (
                  <span
                    key={kw}
                    className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600"
                  >
                    {kw}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </Card>

      {!enabled && (
        <Card>
          <EmptyState
            title="Escribí palabras clave arriba"
            hint="Ej: 'software, licencia' para analizar precios de software. O probá un preset."
          />
        </Card>
      )}

      {hasError && (
        <ErrorBanner message="Error al cargar el análisis de precios. Reintentá en unos segundos." />
      )}

      {enabled && (
        <>
          {/* ── Summary cards + granularity switch ── */}
          <SummaryCards
            loading={priceHistory.isLoading}
            data={priceHistory.data}
            onGroupBy={setGroupBy}
            groupBy={groupBy}
          />

          {/* ── Price evolution ── */}
          <Card>
            <CardHeader
              title="Evolución de precios"
              subtitle="Precio promedio (línea) y número de contratos (barras) por periodo"
            />
            <div className="p-4">
              <PriceEvolutionChart loading={priceHistory.isLoading} data={priceHistory.data} />
            </div>
          </Card>

          {/* ── Distribution ── */}
          <Card>
            <CardHeader
              title="Distribución de precios"
              subtitle="Cuántos contratos cayó en cada rango de monto"
            />
            <div className="p-4">
              <DistributionChart loading={distribution.isLoading} data={distribution.data} />
            </div>
          </Card>

          {/* ── Suppliers ── */}
          <Card>
            <CardHeader
              title="Proveedores y precios"
              subtitle={`Top ${SUPPLIERS_LIMIT} proveedores por monto total en el segmento`}
            />
            <SuppliersTable loading={suppliers.isLoading} rows={suppliers.data?.suppliers ?? []} />
          </Card>

          {/* ── Top contracts ── */}
          <Card>
            <CardHeader
              title="Contratos más grandes"
              subtitle={`${topContracts.data?.pagination.total ?? 0} contratos con precio · página ${topContractsPage}`}
              action={
                topContracts.data && topContracts.data.pagination.total_pages > 1 ? (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      disabled={topContractsPage <= 1}
                      onClick={() => setTopContractsPage((p) => Math.max(1, p - 1))}
                    >
                      ← Anterior
                    </Button>
                    <span className="text-xs text-slate-500">
                      {topContractsPage} / {topContracts.data.pagination.total_pages}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      disabled={topContractsPage >= topContracts.data.pagination.total_pages}
                      onClick={() =>
                        setTopContractsPage((p) => Math.min(topContracts.data!.pagination.total_pages, p + 1))
                      }
                    >
                      Siguiente →
                    </Button>
                  </div>
                ) : null
              }
            />
            <TopContractsTable loading={topContracts.isLoading} rows={topContracts.data?.data ?? []} />
          </Card>
        </>
      )}
    </div>
  );
}

// ─── Summary cards ────────────────────────────────────────────────────────

function SummaryCards({
  loading,
  data,
  onGroupBy,
  groupBy,
}: {
  loading: boolean;
  data: PriceHistory | undefined;
  onGroupBy: (g: PriceGroupBy) => void;
  groupBy: PriceGroupBy;
}) {
  const overall = data?.overall;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Agrupar por:</span>
        {(['year', 'quarter', 'month'] as const).map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => onGroupBy(g)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
              groupBy === g
                ? 'bg-institucional text-white'
                : 'bg-white text-slate-600 ring-1 ring-inset ring-slate-300 hover:bg-slate-50'
            }`}
          >
            {g === 'year' ? 'Año' : g === 'quarter' ? 'Trimestre' : 'Mes'}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric
          label="Contratos con precio"
          loading={loading}
          value={overall ? formatNumber(overall.total_contracts) : '—'}
        />
        <Metric
          label="Precio promedio"
          loading={loading}
          value={overall && overall.total_contracts > 0 ? formatCurrencyCompact(overall.avg_price) : '—'}
        />
        <Metric
          label="Precio mediano"
          loading={loading}
          value={overall && overall.total_contracts > 0 ? formatCurrencyCompact(overall.median_price) : '—'}
          hint="menos sensible a outliers que el promedio"
        />
        <TrendCard loading={loading} trend={data?.trend} periods={data?.periods ?? []} />
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  loading,
  hint,
}: {
  label: string;
  value: string;
  loading: boolean;
  hint?: string;
}) {
  return (
    <Card className="px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      {loading ? (
        <Skeleton className="mt-1.5 h-6 w-24" />
      ) : (
        <div className="mt-1 text-xl font-semibold text-slate-900">{value}</div>
      )}
      {hint && !loading && <div className="mt-0.5 text-[10px] text-slate-400">{hint}</div>}
    </Card>
  );
}

function TrendCard({
  loading,
  trend,
  periods,
}: {
  loading: boolean;
  trend?: TrendDirection;
  periods: { avg_price: number; period: string }[];
}) {
  if (loading) {
    return (
      <Card className="px-4 py-3">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Tendencia</div>
        <Skeleton className="mt-1.5 h-6 w-24" />
      </Card>
    );
  }
  if (!trend || periods.length < 2) {
    return (
      <Card className="px-4 py-3">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Tendencia</div>
        <div className="mt-1 text-xl font-semibold text-slate-400">—</div>
      </Card>
    );
  }
  const first = periods[0]!.avg_price;
  const last = periods[periods.length - 1]!.avg_price;
  const pct = first > 0 ? ((last - first) / first) * 100 : 0;
  const meta = trendMeta(trend);
  return (
    <Card className="px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Tendencia</div>
      <div className={`mt-1 flex items-center gap-1 text-xl font-bold ${meta.color}`}>
        <span>{meta.arrow}</span>
        <span>{Math.abs(pct).toFixed(1)}%</span>
      </div>
      <div className="mt-0.5 text-[10px] text-slate-400">
        {periods[0]!.period} → {periods[periods.length - 1]!.period}
      </div>
    </Card>
  );
}

function trendMeta(trend: TrendDirection): { arrow: string; color: string; label: string } {
  if (trend === 'increasing') return { arrow: '↑', color: 'text-red-600', label: 'Sube' };
  if (trend === 'decreasing') return { arrow: '↓', color: 'text-emerald-600', label: 'Baja' };
  return { arrow: '→', color: 'text-slate-500', label: 'Estable' };
}

// ─── Price evolution ComposedChart ────────────────────────────────────────

function PriceEvolutionChart({ loading, data }: { loading: boolean; data: PriceHistory | undefined }) {
  if (loading) return <ChartLoading />;
  if (!data || data.periods.length === 0) {
    return <EmptyState title="Sin datos de precios para este segmento" />;
  }
  const chartData = data.periods.map((p) => ({
    period: p.period,
    avg: p.avg_price,
    median: p.median_price,
    contracts: p.contracts,
  }));
  return (
    <div style={{ width: '100%', height: CHART_HEIGHT }}>
      <ResponsiveContainer>
        <ComposedChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="period" tick={{ fontSize: 12 }} stroke="#94a3b8" />
          <YAxis
            yAxisId="price"
            tickFormatter={(v: number) => formatCurrencyCompact(v)}
            tick={{ fontSize: 11 }}
            stroke="#94a3b8"
          />
          <YAxis
            yAxisId="count"
            orientation="right"
            tickFormatter={(v: number) => formatNumber(v)}
            tick={{ fontSize: 11 }}
            stroke="#94a3b8"
          />
          <Tooltip
            formatter={(value, name) => {
              if (name === 'contracts') return [formatNumber(Number(value)), 'Contratos'];
              return [formatCurrency(Number(value)), priceSeriesLabel(String(name ?? ''))];
            }}
            labelFormatter={(label, payload) => {
              const c = payload?.[0]?.payload?.contracts;
              return c != null ? `${label} · ${formatNumber(c)} contratos` : String(label);
            }}
            contentStyle={tooltipStyle}
          />
          <Legend formatter={(name) => priceSeriesLabel(String(name))} wrapperStyle={{ fontSize: 11 }} />
          <Bar yAxisId="count" dataKey="contracts" name="contracts" fill="#e0e7ff" radius={[4, 4, 0, 0]} />
          <Line
            yAxisId="price"
            type="monotone"
            dataKey="avg"
            name="avg"
            stroke={CHART_PALETTE[0]}
            strokeWidth={2.5}
            dot={{ r: 3 }}
          />
          <Line
            yAxisId="price"
            type="monotone"
            dataKey="median"
            name="median"
            stroke={CHART_PALETTE[2]}
            strokeWidth={2}
            strokeDasharray="4 4"
            dot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function priceSeriesLabel(name: string | number): string {
  const s = String(name);
  if (s === 'avg') return 'Precio promedio';
  if (s === 'median') return 'Mediana';
  if (s === 'contracts') return 'Contratos';
  return s;
}

// ─── Distribution BarChart ────────────────────────────────────────────────

function DistributionChart({
  loading,
  data,
}: {
  loading: boolean;
  data: PriceDistribution | undefined;
}) {
  if (loading) return <ChartLoading />;
  if (!data || data.buckets.length === 0) return <EmptyState title="Sin datos de distribución" />;
  const chartData = data.buckets.map((b) => ({
    name: b.label,
    count: b.count,
  }));
  return (
    <div style={{ width: '100%', height: CHART_HEIGHT }}>
      <ResponsiveContainer>
        <BarChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="#94a3b8" interval={0} />
          <YAxis tickFormatter={(v: number) => formatNumber(v)} tick={{ fontSize: 11 }} stroke="#94a3b8" />
          <Tooltip
            formatter={(value) => [formatNumber(Number(value)), 'Contratos']}
            contentStyle={tooltipStyle}
          />
          <Bar dataKey="count" name="Contratos" radius={[4, 4, 0, 0]}>
            {chartData.map((_, i) => (
              <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Suppliers table ──────────────────────────────────────────────────────

function SuppliersTable({ loading, rows }: { loading: boolean; rows: ProductSupplier[] }) {
  if (loading) return <TableSkeleton cols={6} />;
  if (rows.length === 0) return <EmptyState title="Sin proveedores con precio para este segmento" />;
  return (
    <TableWrap>
      <thead className="bg-slate-50">
        <tr>
          <Th>Proveedor</Th>
          <Th right>Contratos</Th>
          <Th right>Precio prom.</Th>
          <Th right>Mín</Th>
          <Th right>Máx</Th>
          <Th right>Total</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map((r) => (
          <tr key={r.rfc} className="hover:bg-institucional-50/40">
            <Td>
              <span className="font-medium text-slate-900">{truncate(r.nombre, 44)}</span>
              <span className="block text-xs text-slate-400">{r.rfc}</span>
            </Td>
            <Td right>{formatNumber(r.contracts)}</Td>
            <Td right>{formatCurrencyCompact(r.avg_price)}</Td>
            <Td right>{formatCurrencyCompact(r.min_price)}</Td>
            <Td right>{formatCurrencyCompact(r.max_price)}</Td>
            <Td right>
              <span className="font-medium text-slate-900">{formatCurrency(r.total_amount)}</span>
            </Td>
          </tr>
        ))}
      </tbody>
    </TableWrap>
  );
}

// ─── Top contracts table ──────────────────────────────────────────────────

function TopContractsTable({ loading, rows }: { loading: boolean; rows: ProductTopContract[] }) {
  if (loading) return <TableSkeleton cols={5} />;
  if (rows.length === 0) return <EmptyState title="Sin contratos con precio para este segmento" />;
  return (
    <TableWrap>
      <thead className="bg-slate-50">
        <tr>
          <Th>Procedimiento</Th>
          <Th>Proveedor</Th>
          <Th>Dependencia</Th>
          <Th right>Monto</Th>
          <Th>Firma</Th>
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
              <span className="block text-xs text-slate-500">
                {truncate(r.titulo ?? r.descripcion ?? '—', 60)}
              </span>
            </Td>
            <Td>
              {r.supplier_nombre ? (
                <Link
                  to={`/proveedores?rfc=${encodeURIComponent(r.supplier_rfc ?? '')}`}
                  className="text-xs text-institucional hover:underline"
                >
                  {truncate(r.supplier_nombre, 30)}
                </Link>
              ) : (
                <span className="text-xs text-slate-300">—</span>
              )}
            </Td>
            <Td>
              <span className="text-xs text-slate-700">{truncate(r.institucion_nombre, 30)}</span>
            </Td>
            <Td right>
              <span className="text-xs font-medium text-slate-900">{formatCurrency(r.importe_drc)}</span>
            </Td>
            <Td>
              <span className="text-xs text-slate-600">{formatDate(r.fecha_firma)}</span>
            </Td>
          </tr>
        ))}
      </tbody>
    </TableWrap>
  );
}

// ─── Shared primitives ────────────────────────────────────────────────────

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

/** Mirror of the backend's parseProductKeywords for the draft input. */
function parseKeywords(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[\n,]+/)) {
    const kw = part.trim().replace(/\s+/g, ' ');
    if (!kw) continue;
    const key = kw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(kw);
  }
  return out;
}
