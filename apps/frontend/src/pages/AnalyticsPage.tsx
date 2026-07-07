import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { motion } from 'motion/react';
import { Card, CardHeader, ErrorBanner, Skeleton, Spinner } from '../components/ui';
import { AnimatedNumber } from '../components/AnimatedNumber';
import { staggerContainer, staggerItem } from '../lib/motion';
import { useProcedureListFilters } from '../hooks/useProcedureListFilters';
import {
  useAnalyticsByInstitucion,
  useAnalyticsByTipoContratacion,
  useAnalyticsSummary,
  useAnalyticsTopProveedores,
} from '../api/queries';
import { formatCurrency, formatCurrencyCompact, formatNumber } from '../utils/format';
import { FilterSidebar } from '../components/FilterSidebar';
import { FilterChips } from '../components/FilterChips';
import type { ProcedureFilter } from '../types';

const CHART_HEIGHT = 320;
const CHART_PALETTE = ['#611232', '#872240', '#a93853', '#cd5a78', '#e08aa5', '#3a0b1f', '#5a1530', '#7b1e3e', '#9c2a4c', '#bf3f64'];

/**
 * Page 3: cost-analytics dashboard (UI-5 SHOULD). Every chart reuses the
 * same filter state as the list page, so analytics always reflect the same
 * slice the user is exploring (CA-6).
 */
export function AnalyticsPage() {
  const { query, update, reset, hasActiveFilters } = useProcedureListFilters();
  // The list-page filter state carries page/sort keys; analytics only uses
  // the filter slice. Build the filter-only object the hooks expect.
  const filter = useMemo(() => toFilter(query), [query]);

  const summary = useAnalyticsSummary(filter);
  const byInst = useAnalyticsByInstitucion(filter, 10);
  const byTipo = useAnalyticsByTipoContratacion(filter);
  const topSup = useAnalyticsTopProveedores(filter, 10);

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <FilterSidebar
        value={filter}
        onChange={(patch) => update(patch as ProcedureFilter)}
        onReset={reset}
      />
      <div className="min-w-0 flex-1 space-y-5">
        <div>
          <h1 className="font-display text-xl font-semibold text-slate-900">Costos y estadísticas</h1>
          <p className="text-sm text-slate-500">
            Agregados sobre los procedimientos cargados{hasActiveFilters ? ' (con filtros aplicados)' : ''}.
          </p>
          <FilterChips filter={filter} />
        </div>

        {(summary.isError || byInst.isError || byTipo.isError || topSup.isError) && (
          <ErrorBanner message="Error al cargar las estadísticas. Intenta de nuevo." />
        )}

        <SummaryCards
          loading={summary.isLoading}
          data={summary.data}
        />

        <div className="grid gap-5 lg:grid-cols-2">
          <ChartCard title="Top instituciones por monto" subtitle="Total adjudicado (MXN)">
            <BarChartAsync
              query={{
                isLoading: byInst.isLoading,
                isError: byInst.isError,
                data: byInst.data?.data,
                refetch: byInst.refetch,
              }}
              dataKey="total_monto"
              nameKey="nombre"
              horizontal
            />
          </ChartCard>

          <ChartCard title="Monto por tipo de contratación" subtitle="Suma de importes">
            <BarChartAsync
              query={{
                isLoading: byTipo.isLoading,
                isError: byTipo.isError,
                data: byTipo.data?.por_tipo_contratacion,
                refetch: byTipo.refetch,
              }}
              dataKey="total_monto"
              nameKey="clave"
            />
          </ChartCard>

          <ChartCard title="Top proveedores por monto" subtitle="Por importe de contratos">
            <BarChartAsync
              query={{
                isLoading: topSup.isLoading,
                isError: topSup.isError,
                data: topSup.data?.data,
                refetch: topSup.refetch,
              }}
              dataKey="total_monto"
              nameKey="nombre"
              horizontal
            />
          </ChartCard>

          <ChartCard title="Distribución por estatus" subtitle="Cantidad de procedimientos">
            <PieAsync
              loading={summary.isLoading}
              data={summary.data?.por_estatus.map((e) => ({ name: e.estatus ?? 'Sin estatus', value: e.total })) ?? []}
            />
          </ChartCard>
        </div>
      </div>
    </div>
  );
}

// --- Summary cards ---

function SummaryCards({
  loading,
  data,
}: {
  loading: boolean;
  data: import('../types').AnalyticsSummary | undefined;
}) {
  return (
    <motion.div
      className="grid grid-cols-2 gap-3 sm:grid-cols-4"
      initial="hidden"
      animate="visible"
      variants={staggerContainer}
    >
      <SummaryCard label="Total monto" loading={loading} value={data ? formatCurrencyCompact(data.total_monto) : '—'} />
      <SummaryCard
        label="Procedimientos"
        loading={loading}
        value={data ? formatNumber(data.total_procedimientos) : '—'}
      />
      <SummaryCard label="Contratos" loading={loading} value={data ? formatNumber(data.total_contratos) : '—'} />
      <SummaryCard label="Monto promedio" loading={loading} value={data ? formatCurrencyCompact(data.monto_promedio) : '—'} />
    </motion.div>
  );
}

function SummaryCard({ label, value, loading }: { label: string; value: string; loading: boolean }) {
  return (
    <motion.div variants={staggerItem}>
      <Card className="px-4 py-3">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
        {loading ? (
          <Skeleton className="mt-1.5 h-6 w-24" />
        ) : (
          <div className="mt-1 font-mono text-xl font-semibold text-slate-900">
            <AnimatedNumber value={value} />
          </div>
        )}
      </Card>
    </motion.div>
  );
}

// --- Chart card wrapper ---

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} subtitle={subtitle} />
      <div className="p-4">{children}</div>
    </Card>
  );
}

// --- Recharts-based async chart ---

interface BarQueryLike<T> {
  isLoading: boolean;
  isError: boolean;
  data?: T[] | undefined;
  refetch: () => unknown;
}

function BarChartAsync<T>({
  query,
  dataKey,
  nameKey,
  horizontal,
}: {
  query: BarQueryLike<T>;
  dataKey: keyof T & string;
  nameKey: keyof T & string;
  horizontal?: boolean;
}) {
  if (query.isLoading) {
    return <ChartLoading />;
  }
  if (query.isError) {
    return (
      <button
        type="button"
        onClick={() => query.refetch()}
        className="mx-auto block text-xs text-institucional hover:underline"
      >
        Error al cargar. Reintentar.
      </button>
    );
  }
  const rows = query.data ?? [];
  if (rows.length === 0) {
    return <div className="grid h-[200px] place-items-center text-xs text-slate-400">Sin datos para los filtros actuales.</div>;
  }
  const data = rows.map((r) => {
    const row = r as Record<string, unknown>;
    return {
      name: truncate(String(row[nameKey] ?? '—'), 40),
      value: Number(row[dataKey] ?? 0),
    };
  });

  const layout = horizontal ? 'vertical' : 'horizontal';
  return (
    <div style={{ width: '100%', height: CHART_HEIGHT }}>
      <ResponsiveContainer>
        <BarChart data={data} layout={layout} margin={{ top: 8, right: 16, bottom: 8, left: 16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          {horizontal ? (
            <>
              <XAxis type="number" tickFormatter={(v: number) => formatCurrencyCompact(v)} tick={{ fontSize: 11 }} stroke="#94a3b8" />
              <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 11 }} stroke="#94a3b8" />
            </>
          ) : (
            <>
              <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="#94a3b8" interval={0} angle={-15} textAnchor="end" height={70} />
              <YAxis tickFormatter={(v: number) => formatCurrencyCompact(v)} tick={{ fontSize: 11 }} stroke="#94a3b8" />
            </>
          )}
          <Tooltip formatter={(v) => formatCurrency(Number(v))} contentStyle={tooltipStyle} />
          <Bar dataKey="value" name="Monto" radius={[4, 4, 0, 0]}>
            {data.map((_, i) => (
              <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

const tooltipStyle = {
  borderRadius: 8,
  border: '1px solid #e2e8f0',
  fontSize: 12,
  boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
} as const;

function ChartLoading() {
  return (
    <div className="grid place-items-center gap-2" style={{ height: CHART_HEIGHT }}>
      <Spinner className="h-5 w-5 text-institucional" />
      <span className="text-xs text-slate-400">Cargando…</span>
    </div>
  );
}

function PieAsync({ loading, data }: { loading: boolean; data: { name: string; value: number }[] }) {
  if (loading) return <ChartLoading />;
  if (data.length === 0) {
    return <div className="grid h-[200px] place-items-center text-xs text-slate-400">Sin datos.</div>;
  }
  return (
    <div style={{ width: '100%', height: CHART_HEIGHT }}>
      <ResponsiveContainer>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} innerRadius={45}>
            {data.map((_, i) => (
              <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />
            ))}
          </Pie>
          <Tooltip formatter={(v) => formatNumber(Number(v))} contentStyle={tooltipStyle} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function toFilter(q: import('../types').ProcedureListQuery): ProcedureFilter {
  const { page: _p, page_size: _ps, sort: _s, order: _o, ...filter } = q;
  return filter;
}
