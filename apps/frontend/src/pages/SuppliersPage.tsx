import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardHeader, Badge, ErrorBanner, Skeleton, Spinner, EmptyState } from '../components/ui';
import { useSupplierSearch, useSupplierProfile } from '../api/queries';
import { formatCurrency, formatCurrencyCompact, formatNumber, formatDate } from '../utils/format';
import type {
  SupplierProfile,
  SupplierSearchResult,
  SupplierTopContract,
} from '../types';

const CHART_HEIGHT = 300;
const CHART_PALETTE = ['#611232', '#872240', '#a93853', '#cd5a78', '#e08aa5', '#3a0b1f', '#5a1530', '#7b1e3e', '#9c2a4c', '#bf3f64'];
const tooltipStyle = { borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' } as const;
const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_MIN_CHARS = 2;

/**
 * Page: Supplier Intelligence (PR9). Lets the user search any proveedor by name
 * or RFC (case + accent insensitive) and explore a full analysis of their
 * business with the Mexican government: totals, yearly evolution, the agencies
 * that buy from them, what they sell, their biggest contracts, and their market
 * rank among all 60K+ suppliers.
 *
 * The search dropdown fires after a 300ms debounce; selecting a supplier loads
 * the profile below (~0.3–0.6s on real data).
 */
export function SuppliersPage() {
  const [draft, setDraft] = useState('');
  const [debounced, setDebounced] = useState('');
  const [selectedRfc, setSelectedRfc] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  // Debounce the search query so we don't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(draft.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [draft]);

  // Close the dropdown when clicking outside the search container.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const search = useSupplierSearch(debounced);
  const profile = useSupplierProfile(selectedRfc);

  function pick(rfc: string) {
    setSelectedRfc(rfc);
    setDropdownOpen(false);
    setDraft('');
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-xl font-semibold text-slate-900">Proveedores</h1>
        <p className="text-sm text-slate-500">
          Buscá cualquier proveedor por nombre o RFC y analizá su negocio con el gobierno.
        </p>
      </div>

      {/* ── Search bar with dropdown ── */}
      <div className="relative" ref={searchRef}>
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
            </svg>
          </span>
          <input
            type="text"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setDropdownOpen(true);
            }}
            onFocus={() => setDropdownOpen(true)}
            placeholder="Buscar proveedor por nombre o RFC…  (ej. AXTEL, ICA, AXT940727FP8)"
            className="w-full rounded-lg border border-slate-300 py-3 pl-11 pr-4 text-sm shadow-sm focus:border-institucional focus:outline-none focus:ring-1 focus:ring-institucional"
          />
          {search.isFetching && (
            <Spinner className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-institucional" />
          )}
        </div>

        {dropdownOpen && debounced.length >= SEARCH_MIN_CHARS && (
          <SearchDropdown
            loading={search.isLoading}
            results={search.data?.data ?? []}
            error={search.isError}
            onPick={pick}
          />
        )}
      </div>

      {/* ── Profile dashboard ── */}
      {!selectedRfc && (
        <Card>
          <EmptyState
            title="Buscá un proveedor arriba"
            hint="Escribí un nombre (ej. AXTEL) o un RFC para ver su análisis completo."
          />
        </Card>
      )}

      {selectedRfc && profile.isLoading && <ProfileSkeleton />}

      {selectedRfc && profile.isError && (
        <ErrorBanner
          message="No se pudo cargar el perfil del proveedor. Reintentá en unos segundos."
          onRetry={() => profile.refetch()}
        />
      )}

      {selectedRfc && profile.data && <ProfileDashboard data={profile.data} />}
    </div>
  );
}

// ─── Search dropdown ──────────────────────────────────────────────────────

function SearchDropdown({
  loading,
  results,
  error,
  onPick,
}: {
  loading: boolean;
  results: SupplierSearchResult[];
  error: boolean;
  onPick: (rfc: string) => void;
}) {
  if (error) {
    return (
      <div className="absolute z-20 mt-1 w-full rounded-lg border border-slate-200 bg-white p-4 text-sm text-red-600 shadow-lg">
        Error al buscar. Intentalo de nuevo.
      </div>
    );
  }
  if (loading && results.length === 0) {
    return (
      <div className="absolute z-20 mt-1 w-full rounded-lg border border-slate-200 bg-white p-4 shadow-lg">
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Spinner className="h-4 w-4 text-institucional" /> Buscando…
        </div>
      </div>
    );
  }
  if (results.length === 0) {
    return (
      <div className="absolute z-20 mt-1 w-full rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500 shadow-lg">
        Sin resultados. Probá con otro nombre o RFC.
      </div>
    );
  }
  return (
    <ul className="absolute z-20 mt-1 max-h-96 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
      {results.map((r) => (
        <li key={r.id}>
          <button
            type="button"
            onClick={() => onPick(r.rfc)}
            className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-institucional-50"
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-slate-900">{truncate(r.nombre, 52)}</div>
              <div className="mt-0.5 flex items-center gap-2">
                <span className="text-xs text-slate-400">{r.rfc}</span>
                {r.estratificacion && (
                  <Badge tone="neutral" className="px-1.5 py-0 text-[10px]">
                    {r.estratificacion}
                  </Badge>
                )}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-xs font-semibold text-slate-700">{formatCurrencyCompact(r.total_amount)}</div>
              <div className="text-[11px] text-slate-400">{formatNumber(r.total_contracts)} contratos</div>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

// ─── Profile dashboard ───────────────────────────────────────────────────

function ProfileDashboard({ data }: { data: SupplierProfile }) {
  const { supplier, summary, market_position } = data;
  const hasAmounts = summary.total_amount > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-slate-900">{supplier.nombre}</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-slate-500">{supplier.rfc}</span>
              {supplier.estratificacion && <Badge tone="institucional">{supplier.estratificacion}</Badge>}
              {supplier.nacionalidad && <Badge tone="info">{supplier.nacionalidad}</Badge>}
              {supplier.pais && <Badge tone="neutral">{supplier.pais}</Badge>}
            </div>
          </div>
          {market_position && (
            <div className="rounded-lg bg-institucional-50 px-4 py-2 text-center ring-1 ring-inset ring-institucional-200">
              <div className="text-xs font-medium uppercase tracking-wide text-institucional-700">Ranking</div>
              <div className="text-lg font-bold text-institucional">
                #{formatNumber(market_position.rank_by_amount)}
              </div>
              <div className="text-[11px] text-institucional-600">
                de {formatNumber(market_position.total_suppliers)} · top {(100 - market_position.percentile).toFixed(2)}%
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Summary cards (5) */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Metric label="Contratos totales" value={formatNumber(summary.total_contracts)} />
        <Metric label="Monto total" value={hasAmounts ? formatCurrencyCompact(summary.total_amount) : 'Sin montos'} />
        <Metric label="Monto promedio" value={hasAmounts ? formatCurrencyCompact(summary.avg_amount) : '—'} />
        <Metric label="Contratos vigentes" value={formatNumber(summary.active_contracts)} />
        <Metric label="Años activo" value={summary.years_active.length > 0 ? summary.years_active.join(' · ') : '—'} />
      </div>

      {/* Yearly evolution */}
      <Card>
        <CardHeader title="Evolución por año" subtitle="Monto adjudicado (MXN) y número de contratos por año" />
        <div className="p-4">
          {data.by_year.length === 0 ? (
            <EmptyState title="Sin contratos con fecha" />
          ) : (
            <YearChart rows={data.by_year} />
          )}
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* By institution */}
        <Card>
          <CardHeader
            title="Dependencias que le compran"
            subtitle="Top 10 agencias por monto y su % de los ingresos del proveedor"
          />
          <div className="p-4">
            {data.by_institution.length === 0 ? (
              <EmptyState title="Sin dependencias registradas" />
            ) : (
              <InstitutionsBlock rows={data.by_institution} />
            )}
          </div>
        </Card>

        {/* By contract type */}
        <Card>
          <CardHeader
            title="Tipos de contratos"
            subtitle="Qué le vende este proveedor al gobierno (ADQUISICIONES, SERVICIOS…)"
          />
          <div className="p-4">
            {data.by_tipo_contratacion.length === 0 ? (
              <EmptyState title="Sin tipos registrados" />
            ) : (
              <TipoChart rows={data.by_tipo_contratacion} />
            )}
          </div>
        </Card>
      </div>

      {/* Top contracts */}
      <Card>
        <CardHeader title="Contratos más grandes" subtitle="Top 10 por monto adjudicado" />
        <TopContractsTable rows={data.top_contracts} hasAmounts={hasAmounts} />
      </Card>
    </div>
  );
}

// ─── Summary metric card ─────────────────────────────────────────────────

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card className="px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-slate-900">{value}</div>
    </Card>
  );
}

// ─── Year bar chart ──────────────────────────────────────────────────────

function YearChart({ rows }: { rows: { year: number; contracts: number; amount: number }[] }) {
  const data = rows.map((r) => ({ name: String(r.year), value: r.amount, contracts: r.contracts }));
  return (
    <div style={{ width: '100%', height: CHART_HEIGHT }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="name" tick={{ fontSize: 12 }} stroke="#94a3b8" />
          <YAxis tickFormatter={(v: number) => formatCurrencyCompact(v)} tick={{ fontSize: 11 }} stroke="#94a3b8" />
          <Tooltip
            formatter={(v) => formatCurrency(Number(v))}
            labelFormatter={(_l, payload) => {
              const c = payload?.[0]?.payload?.contracts;
              return c != null ? `${c} contratos` : '';
            }}
            contentStyle={tooltipStyle}
          />
          <Bar dataKey="value" name="Monto" radius={[4, 4, 0, 0]} fill={CHART_PALETTE[0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Institutions: horizontal bar + table ────────────────────────────────

function InstitutionsBlock({ rows }: { rows: { nombre: string; contracts: number; amount: number; share_pct: number }[] }) {
  const chartData = rows.map((r) => ({ name: truncate(r.nombre, 32), value: r.amount }));
  return (
    <div className="space-y-4">
      <div style={{ width: '100%', height: CHART_HEIGHT }}>
        <ResponsiveContainer>
          <BarChart data={chartData} layout="vertical" margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis type="number" tickFormatter={(v: number) => formatCurrencyCompact(v)} tick={{ fontSize: 11 }} stroke="#94a3b8" />
            <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 10 }} stroke="#94a3b8" />
            <Tooltip formatter={(v) => formatCurrency(Number(v))} contentStyle={tooltipStyle} />
            <Bar dataKey="value" name="Monto" radius={[0, 4, 4, 0]}>
              {chartData.map((_, i) => (
                <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              <Th>Dependencia</Th>
              <Th right>Contratos</Th>
              <Th right>Monto</Th>
              <Th right>% ingresos</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.nombre} className="hover:bg-slate-50">
                <Td>{truncate(r.nombre, 44)}</Td>
                <Td right>{formatNumber(r.contracts)}</Td>
                <Td right>{formatCurrency(r.amount)}</Td>
                <Td right>
                  <Badge tone={r.share_pct >= 25 ? 'warning' : 'neutral'}>{r.share_pct.toFixed(2)}%</Badge>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Tipo contratación pie chart ─────────────────────────────────────────

function TipoChart({ rows }: { rows: { tipo: string; contracts: number; amount: number }[] }) {
  const data = rows.map((r) => ({ name: r.tipo, value: r.amount }));
  const total = data.reduce((acc, d) => acc + d.value, 0);
  return (
    <div style={{ width: '100%', height: CHART_HEIGHT }}>
      <ResponsiveContainer>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} innerRadius={45}>
            {data.map((_, i) => (
              <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(v) => formatCurrency(Number(v))}
            contentStyle={tooltipStyle}
          />
          <Legend
            formatter={(value: string) => {
              const row = rows.find((r) => r.tipo === value);
              const pct = total > 0 && row ? ((row.amount / total) * 100).toFixed(1) : '0';
              return `${value} (${pct}%)`;
            }}
            wrapperStyle={{ fontSize: 11 }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Top contracts table ─────────────────────────────────────────────────

function TopContractsTable({ rows, hasAmounts }: { rows: SupplierTopContract[]; hasAmounts: boolean }) {
  if (rows.length === 0) {
    return (
      <div className="p-4">
        <EmptyState title={hasAmounts ? 'Sin contratos registrados' : 'Sin montos registrados'} />
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200">
        <thead className="bg-slate-50">
          <tr>
            <Th>Procedimiento</Th>
            <Th>Dependencia</Th>
            <Th right>Monto</Th>
            <Th>Firma</Th>
            <Th>Estatus</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.numero_procedimiento} className="hover:bg-slate-50">
              <Td>
                <Link
                  to={`/procedimientos/${encodeURIComponent(r.numero_procedimiento)}`}
                  className="font-medium text-institucional hover:underline"
                >
                  {r.numero_procedimiento}
                </Link>
                <span className="block text-xs text-slate-500">{truncate(r.titulo ?? r.descripcion ?? '—', 60)}</span>
              </Td>
              <Td>
                <span className="text-xs text-slate-700">{truncate(r.institucion, 30)}</span>
              </Td>
              <Td right>
                <span className="text-xs">{r.importe_drc == null ? '—' : formatCurrency(r.importe_drc)}</span>
              </Td>
              <Td>
                <span className="text-xs text-slate-600">{formatDate(r.fecha_firma)}</span>
              </Td>
              <Td>
                {r.estatus_contrato ? <Badge tone="info">{r.estatus_contrato}</Badge> : <span className="text-slate-300">—</span>}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Loading skeleton ────────────────────────────────────────────────────

function ProfileSkeleton() {
  return (
    <div className="space-y-4">
      <Card className="p-5">
        <Skeleton className="h-6 w-72" />
        <Skeleton className="mt-3 h-4 w-48" />
      </Card>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Card key={i} className="px-4 py-3">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-2 h-5 w-16" />
          </Card>
        ))}
      </div>
      <Card>
        <div className="flex items-center gap-2 px-5 py-4 text-sm text-slate-400">
          <Spinner className="h-4 w-4 text-institucional" /> Cargando análisis…
        </div>
      </Card>
    </div>
  );
}

// ─── Shared table primitives ─────────────────────────────────────────────

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

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
