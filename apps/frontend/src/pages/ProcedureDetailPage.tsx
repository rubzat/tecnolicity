import { Link, useParams } from 'react-router-dom';
import { useProcedureDetail } from '../api/queries';
import { ApiRequestError } from '../api/client';
import { Badge, Card, CardHeader, EmptyState, ErrorBanner, Spinner, estatusTone } from '../components/ui';
import { DocumentsSection } from '../components/DocumentsSection';
import { ScrollShadowX } from '../components/ScrollShadowX';
import { formatCurrency, formatDate, formatDateTime } from '../utils/format';
import type { AmountView, ContractView, ProcedureDetail } from '../types';

/**
 * Page 2: full procedure detail (UI-2, UI-4).
 *
 * Renders procedure header, info grid, institution & UC cards, expedientes,
 * contracts (with amounts + supplier), and a placeholder documents section
 * pointing to the official URL (PR4 will add Playwright on-demand fetching).
 */
export function ProcedureDetailPage() {
  const { numeroProcedimiento } = useParams<{ numeroProcedimiento: string }>();
  const { data, isLoading, isError, error, refetch } = useProcedureDetail(numeroProcedimiento);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-16 text-sm text-slate-500">
        <Spinner className="h-5 w-5 text-institucional" /> Cargando procedimiento…
      </div>
    );
  }

  if (isError) {
    const is404 = error instanceof ApiRequestError && error.status === 404;
    return (
      <div className="space-y-4">
        <BackLink />
        {is404 ? (
          <EmptyState
            title={`No existe el procedimiento "${numeroProcedimiento}"`}
            hint="Verifica el número o vuelve a la lista para elegir otro."
          />
        ) : (
          <ErrorBanner
            message={error instanceof Error ? error.message : 'Error al cargar el procedimiento.'}
            onRetry={() => void refetch()}
          />
        )}
      </div>
    );
  }

  if (!data) return null;
  return (
    <div className="space-y-5">
      <BackLink />
      <DetailHeader procedure={data} />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <InfoGrid procedure={data} />
          <ContractsCard contracts={data.contracts} />
          <DocumentsSection numeroProcedimiento={data.numero_procedimiento} direccionAnuncio={data.direccion_anuncio} />
        </div>
        <div className="space-y-5">
          <InstitutionCard procedure={data} />
          <ExpedientesCard expedientes={data.expedientes} />
          <SuppliersCard contracts={data.contracts} />
        </div>
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link to="/" className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-institucional">
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
      </svg>
      Volver a la lista
    </Link>
  );
}

function DetailHeader({ procedure }: { procedure: ProcedureDetail }) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="institucional">{procedure.numero_procedimiento}</Badge>
        <Badge tone={estatusTone(procedure.estatus)}>{procedure.estatus ?? '—'}</Badge>
        {procedure.caracter && <Badge>{procedure.caracter}</Badge>}
        {procedure.contrato_marco && <Badge tone="info">Contrato marco</Badge>}
        {procedure.compra_consolidada && <Badge tone="info">Compra consolidada</Badge>}
      </div>
      <h1 className="mt-2 font-display text-2xl font-semibold text-slate-900">
        {procedure.descripcion ?? 'Procedimiento sin descripción'}
      </h1>
    </div>
  );
}

function InfoGrid({ procedure }: { procedure: ProcedureDetail }) {
  const rows: { label: string; value: string | null | undefined }[] = [
    { label: 'Tipo de contratación', value: procedure.tipo_contratacion },
    { label: 'Tipo de procedimiento', value: procedure.tipo_procedimiento },
    { label: 'Carácter', value: procedure.caracter },
    { label: 'Ley', value: procedure.ley },
    { label: 'Forma de participación', value: procedure.forma_participacion },
    { label: 'Crédito externo', value: booleanLabel(procedure.credito_externo) },
    { label: 'Fecha de publicación', value: formatDateTime(procedure.fecha_publicacion) },
    { label: 'Fecha de apertura', value: formatDateTime(procedure.fecha_apertura) },
    { label: 'Fecha de fallo', value: formatDateTime(procedure.fecha_fallo) },
  ];
  return (
    <Card>
      <CardHeader title="Información del procedimiento" />
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 px-5 py-4 sm:grid-cols-2">
        {rows.map((r) => (
          <div key={r.label} className="flex flex-col">
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{r.label}</dt>
            <dd className="text-sm text-slate-900">{r.value ?? '—'}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function InstitutionCard({ procedure }: { procedure: ProcedureDetail }) {
  const inst = procedure.institucion;
  const uc = procedure.unidad_compradora;
  return (
    <Card>
      <CardHeader title="Institución" />
      <div className="space-y-3 px-5 py-4 text-sm">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Dependencia</div>
          <div className="text-slate-900">
            {inst.siglas ? `${inst.siglas} — ` : ''}
            {inst.nombre}
          </div>
          <div className="text-xs text-slate-500">Clave {inst.clave}</div>
        </div>
        {inst.orden_gobierno && <Meta label="Orden de gobierno" value={inst.orden_gobierno} />}
        {inst.descripcion_ramo && <Meta label="Ramo" value={inst.descripcion_ramo} />}
        <div className="border-t border-slate-100 pt-3">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Unidad compradora</div>
          <div className="text-slate-900">{uc.nombre}</div>
          <div className="text-xs text-slate-500">Clave {uc.clave}</div>
        </div>
      </div>
    </Card>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-slate-900">{value}</div>
    </div>
  );
}

function ExpedientesCard({ expedientes }: { expedientes: ProcedureDetail['expedientes'] }) {
  if (expedientes.length === 0) return null;
  return (
    <Card>
      <CardHeader title="Expedientes" subtitle={`${expedientes.length} expediente(s)`} />
      <ul className="divide-y divide-slate-100 px-5 py-2 text-sm">
        {expedientes.map((e, i) => (
          <li key={e.codigo_expediente ?? i} className="py-2">
            <div className="text-slate-900">{e.titulo ?? 'Sin título'}</div>
            <div className="text-xs text-slate-500">
              {e.codigo_expediente ? `Código ${e.codigo_expediente}` : ''}
              {e.referencia ? ` · Ref ${e.referencia}` : ''}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function SuppliersCard({ contracts }: { contracts: ContractView[] }) {
  const suppliers = contracts
    .map((c) => c.supplier)
    .filter((s): s is NonNullable<typeof s> => s !== null)
    // Dedupe by RFC
    .filter((s, i, arr) => arr.findIndex((o) => o.rfc === s.rfc) === i);

  if (suppliers.length === 0) return null;
  return (
    <Card>
      <CardHeader title="Proveedores" subtitle={`${suppliers.length} proveedor(es)`} />
      <ul className="divide-y divide-slate-100 px-5 py-2 text-sm">
        {suppliers.map((s) => (
          <li key={s.rfc} className="py-2">
            <div className="text-slate-900">{s.nombre}</div>
            <div className="text-xs text-slate-500">
              RFC {s.rfc}
              {s.estratificacion ? ` · ${s.estratificacion}` : ''}
              {s.pais ? ` · ${s.pais}` : ''}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ContractsCard({ contracts }: { contracts: ContractView[] }) {
  return (
    <Card>
      <CardHeader title="Contratos" subtitle={contracts.length === 0 ? 'Sin contratos' : `${contracts.length} contrato(s)`} />
      {contracts.length === 0 ? (
        <EmptyState title="Sin contratos registrados" />
      ) : (
        <ul className="divide-y divide-slate-100">
          {contracts.map((c) => (
            <li key={c.id} className="px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-900">{c.titulo ?? c.numero_contrato ?? `Contrato ${c.id}`}</div>
                  {c.descripcion && <div className="mt-0.5 line-clamp-2 text-xs text-slate-500">{c.descripcion}</div>}
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                    {c.estatus_drc && <Badge tone="neutral">{c.estatus_drc}</Badge>}
                    {c.tipo_contrato && <Badge>{c.tipo_contrato}</Badge>}
                    {c.contrato_plurianual && <Badge tone="info">Plurianual</Badge>}
                    {c.convenio_modificatorio && <Badge tone="warning">Convenio modificatorio</Badge>}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-sm text-slate-900">{formatCurrency(c.importe_drc)}</div>
                  <div className="text-xs text-slate-500">{c.moneda}</div>
                </div>
              </div>

              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-500 sm:grid-cols-4">
                <Detail label="Inicio" value={formatDate(c.fecha_inicio)} />
                <Detail label="Fin" value={formatDate(c.fecha_fin)} />
                <Detail label="Firma" value={formatDate(c.fecha_firma)} />
                <Detail
                  label="Proveedor"
                  value={c.supplier ? c.supplier.nombre : '—'}
                />
              </div>

              {c.amounts.length > 0 && <AmountsTable amounts={c.amounts} />}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-slate-700">{value}</div>
    </div>
  );
}

function AmountsTable({ amounts }: { amounts: AmountView[] }) {
  return (
    <details className="mt-3 group">
      <summary className="cursor-pointer list-none text-xs font-medium text-institucional hover:underline">
        Montos detallados ({amounts.length})
      </summary>
      <ScrollShadowX className="mt-2">
        <table className="w-full border-separate border-spacing-0 text-xs">
          <thead>
            <tr className="text-left text-slate-500">
              <Th>Tipo</Th>
              <Th>Min. sin imp.</Th>
              <Th>Min. con imp.</Th>
              <Th>Máx. sin imp.</Th>
              <Th>Máx. con imp.</Th>
              <Th>Moneda</Th>
            </tr>
          </thead>
          <tbody>
            {amounts.map((a, i) => (
              <tr key={i} className="text-slate-700">
                <Td>
                  <Badge tone={a.tipo === 'convenio' ? 'warning' : 'neutral'}>{a.tipo}</Badge>
                </Td>
                <Td>{formatCurrency(a.monto_sin_imp_min)}</Td>
                <Td>{formatCurrency(a.monto_con_imp_min)}</Td>
                <Td>{formatCurrency(a.monto_sin_imp_max)}</Td>
                <Td>{formatCurrency(a.monto_con_imp_max)}</Td>
                <Td>{a.moneda}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollShadowX>
    </details>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="border-b border-slate-200 px-2 py-1 font-medium">{children}</th>;
}
function Td({ children }: { children: React.ReactNode }) {
  return <td className="border-b border-slate-100 px-2 py-1">{children}</td>;
}

function booleanLabel(v: boolean | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  return v ? 'Sí' : 'No';
}
