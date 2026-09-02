import { useState, type FormEvent } from 'react';
import { Navigate, Link } from 'react-router-dom';
import {
  useAdminSession,
  useSavedSearches,
  useCreateSavedSearch,
  useUpdateSavedSearch,
  useDeleteSavedSearch,
} from '../api/admin-queries';
import type { SavedSearch, SavedSearchFilters } from '../types';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBanner, Skeleton, Spinner } from '../components/ui';
import { ScrollShadowX } from '../components/ScrollShadowX';

/**
 * Admin panel: búsquedas guardadas sobre vigentes. Cada una genera un correo
 * digest cuando aparece una nueva coincidencia, hay un cambio de estatus, o
 * el cierre está próximo (evaluado tras el scrape diario, ver EvaluateAlerts
 * en el backend).
 */
export function AdminAlertsPage() {
  const session = useAdminSession();

  if (session.isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
        <Spinner className="h-5 w-5 text-institucional" /> Verificando sesión…
      </div>
    );
  }
  if (!session.data?.authenticated) {
    return <Navigate to="/admin/login" replace />;
  }
  return <AlertsManager hasEmail={!!session.data.email} />;
}

function AlertsManager({ hasEmail }: { hasEmail: boolean }) {
  const searches = useSavedSearches();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-xl font-semibold text-slate-900">Alertas</h1>
        <p className="text-sm text-slate-500">
          Búsquedas guardadas sobre licitaciones vigentes — te llega un correo cuando hay algo nuevo.
        </p>
      </div>

      {!hasEmail && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          Configura tu email en{' '}
          <Link to="/admin/users" className="font-semibold underline">
            tu cuenta
          </Link>{' '}
          para recibir alertas — sin eso, tus búsquedas se evalúan pero no se te avisa.
        </div>
      )}

      <Card>
        <CardHeader title="Nueva búsqueda guardada" subtitle="Los mismos filtros que la lista de vigentes" />
        <div className="p-4">
          <CreateSavedSearchForm />
        </div>
      </Card>

      <Card>
        <CardHeader title="Tus búsquedas" subtitle={searches.data ? `${searches.data.data.length} en total` : undefined} />
        {searches.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : searches.isError ? (
          <div className="p-4">
            <ErrorBanner message="No se pudieron cargar las búsquedas guardadas." onRetry={() => void searches.refetch()} />
          </div>
        ) : searches.data!.data.length === 0 ? (
          <EmptyState title="Sin búsquedas guardadas" hint="Crea la primera arriba." />
        ) : (
          <SavedSearchesTable searches={searches.data!.data} />
        )}
      </Card>
    </div>
  );
}

function CreateSavedSearchForm() {
  const create = useCreateSavedSearch();
  const [name, setName] = useState('');
  const [filters, setFilters] = useState<SavedSearchFilters>({});

  function setFilter(key: keyof SavedSearchFilters, value: string) {
    setFilters((f) => ({ ...f, [key]: value.trim() || undefined }));
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    create.mutate(
      { name: name.trim(), filters },
      {
        onSuccess: () => {
          setName('');
          setFilters({});
        },
      },
    );
  }

  const inputClass =
    'w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-institucional focus:outline-none focus:ring-1 focus:ring-institucional';

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      {create.isError && <ErrorBanner message="No se pudo crear la búsqueda guardada." />}
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">Nombre *</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Obra pública SICT" className={inputClass} required />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Palabra clave</label>
          <input type="text" value={filters.q ?? ''} onChange={(e) => setFilter('q', e.target.value)} placeholder="ej. software" className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Siglas dependencia</label>
          <input type="text" value={filters.siglas ?? ''} onChange={(e) => setFilter('siglas', e.target.value)} placeholder="ej. SICT" className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Dependencia</label>
          <input type="text" value={filters.dependencia ?? ''} onChange={(e) => setFilter('dependencia', e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Tipo de contratación</label>
          <input type="text" value={filters.tipo_contratacion ?? ''} onChange={(e) => setFilter('tipo_contratacion', e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Tipo de procedimiento</label>
          <input type="text" value={filters.tipo_procedimiento ?? ''} onChange={(e) => setFilter('tipo_procedimiento', e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Entidad federativa</label>
          <input type="text" value={filters.entidad_federativa ?? ''} onChange={(e) => setFilter('entidad_federativa', e.target.value)} className={inputClass} />
        </div>
      </div>
      <Button type="submit" disabled={create.isPending || !name.trim()}>
        {create.isPending ? <Spinner className="h-4 w-4" /> : 'Crear búsqueda guardada'}
      </Button>
    </form>
  );
}

function SavedSearchesTable({ searches }: { searches: SavedSearch[] }) {
  const update = useUpdateSavedSearch();
  const del = useDeleteSavedSearch();
  const [confirmId, setConfirmId] = useState<number | null>(null);

  function summarizeFilters(f: SavedSearchFilters): string {
    const parts = [f.q, f.siglas, f.dependencia, f.tipo_contratacion, f.tipo_procedimiento, f.entidad_federativa].filter(Boolean);
    return parts.length > 0 ? parts.join(' · ') : 'Sin filtros (todas las vigentes)';
  }

  return (
    <ScrollShadowX>
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <th className="px-4 py-2.5">Nombre</th>
            <th className="px-4 py-2.5">Filtros</th>
            <th className="px-4 py-2.5">Estado</th>
            <th className="px-4 py-2.5" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {searches.map((s) => (
            <tr key={s.id} className="hover:bg-institucional-50/40">
              <td className="px-4 py-3 align-top font-medium text-slate-900">{s.name}</td>
              <td className="px-4 py-3 align-top text-xs text-slate-500">{summarizeFilters(s.filters)}</td>
              <td className="px-4 py-3 align-top">
                <Badge tone={s.active ? 'success' : 'neutral'}>{s.active ? 'Activa' : 'Pausada'}</Badge>
              </td>
              <td className="px-4 py-3 align-top">
                <div className="flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    disabled={update.isPending}
                    onClick={() => update.mutate({ id: s.id, active: !s.active })}
                  >
                    {s.active ? 'Pausar' : 'Reactivar'}
                  </Button>
                  {confirmId === s.id ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      type="button"
                      disabled={del.isPending}
                      onClick={() => {
                        del.mutate(s.id);
                        setConfirmId(null);
                      }}
                    >
                      ¿Seguro? Eliminar
                    </Button>
                  ) : (
                    <Button variant="ghost" size="sm" type="button" onClick={() => setConfirmId(s.id)}>
                      Eliminar
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollShadowX>
  );
}
