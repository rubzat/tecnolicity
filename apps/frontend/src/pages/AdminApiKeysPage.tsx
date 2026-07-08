import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import {
  useAdminSession,
  useAdminLogout,
  useApiKeys,
  useCreateApiKey,
  useUpdateApiKey,
  useDeleteApiKey,
} from '../api/admin-queries';
import type { ApiKeyCreated } from '../types';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBanner, Skeleton, Spinner } from '../components/ui';
import { ScrollShadowX } from '../components/ScrollShadowX';
import { formatDateTime } from '../utils/format';

/**
 * Admin panel: issue and manage API keys for the public read API. The one
 * moment of real UX care here is the raw-key reveal — it's the only time
 * the secret is ever shown, so it gets its own persistent banner with a
 * copy button instead of a toast that could disappear before it's copied.
 */
export function AdminApiKeysPage() {
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
  return <ApiKeysManager />;
}

function ApiKeysManager() {
  const keys = useApiKeys();
  const logout = useAdminLogout();
  const [justCreated, setJustCreated] = useState<ApiKeyCreated | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="font-display text-xl font-semibold text-slate-900">API keys</h1>
          <p className="text-sm text-slate-500">
            Cada key eleva el límite de un consumidor de la API pública (/api/vigentes y demás) por
            encima del límite base sin key.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => logout.mutate()} disabled={logout.isPending}>
          Cerrar sesión
        </Button>
      </div>

      {justCreated && <NewKeyBanner apiKey={justCreated} onDismiss={() => setJustCreated(null)} />}

      <Card>
        <CardHeader title="Nueva key" subtitle="Nombre del consumidor (empresa/persona) y, opcional, su límite" />
        <div className="p-4">
          <CreateKeyForm onCreated={setJustCreated} />
        </div>
      </Card>

      <Card>
        <CardHeader title="Keys emitidas" subtitle={keys.data ? `${keys.data.data.length} en total` : undefined} />
        {keys.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : keys.isError ? (
          <div className="p-4">
            <ErrorBanner message="No se pudieron cargar las keys." onRetry={() => void keys.refetch()} />
          </div>
        ) : keys.data!.data.length === 0 ? (
          <EmptyState title="Sin keys emitidas" hint="Crea la primera arriba." />
        ) : (
          <KeysTable keys={keys.data!.data} />
        )}
      </Card>
    </div>
  );
}

function NewKeyBanner({ apiKey, onDismiss }: { apiKey: ApiKeyCreated; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-amber-900">
            Key creada para {apiKey.name} — cópiala ahora, no se vuelve a mostrar.
          </p>
          <code className="mt-2 block break-all rounded bg-white px-3 py-2 font-mono text-xs text-slate-800 ring-1 ring-inset ring-amber-200">
            {apiKey.key}
          </code>
        </div>
        <button type="button" onClick={onDismiss} className="shrink-0 text-amber-600 hover:text-amber-900" aria-label="Cerrar">
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <Button
        variant="secondary"
        size="sm"
        className="mt-3"
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(apiKey.key).then(() => setCopied(true));
        }}
      >
        {copied ? 'Copiada ✓' : 'Copiar key'}
      </Button>
    </div>
  );
}

function CreateKeyForm({ onCreated }: { onCreated: (k: ApiKeyCreated) => void }) {
  const create = useCreateApiKey();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [rateLimit, setRateLimit] = useState('');

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    create.mutate(
      {
        name: name.trim(),
        ...(email.trim() ? { email: email.trim() } : {}),
        ...(rateLimit.trim() ? { rate_limit_per_minute: Number(rateLimit) } : {}),
      },
      {
        onSuccess: (created) => {
          onCreated(created);
          setName('');
          setEmail('');
          setRateLimit('');
        },
      },
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
      {create.isError && (
        <div className="w-full">
          <ErrorBanner message="No se pudo crear la key. Revisa los datos." />
        </div>
      )}
      <div className="min-w-[12rem] flex-1">
        <label className="mb-1 block text-xs font-medium text-slate-600">Nombre *</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Empresa o persona"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-institucional focus:outline-none focus:ring-1 focus:ring-institucional"
          required
        />
      </div>
      <div className="min-w-[12rem] flex-1">
        <label className="mb-1 block text-xs font-medium text-slate-600">Email (opcional)</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="contacto@empresa.com"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-institucional focus:outline-none focus:ring-1 focus:ring-institucional"
        />
      </div>
      <div className="w-40">
        <label className="mb-1 block text-xs font-medium text-slate-600">Límite/min (opcional)</label>
        <input
          type="number"
          min={1}
          value={rateLimit}
          onChange={(e) => setRateLimit(e.target.value)}
          placeholder="300"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-institucional focus:outline-none focus:ring-1 focus:ring-institucional"
        />
      </div>
      <Button type="submit" disabled={create.isPending || !name.trim()}>
        {create.isPending ? <Spinner className="h-4 w-4" /> : 'Crear key'}
      </Button>
    </form>
  );
}

function KeysTable({ keys }: { keys: import('../types').ApiKeySummary[] }) {
  const update = useUpdateApiKey();
  const del = useDeleteApiKey();
  const [confirmId, setConfirmId] = useState<number | null>(null);

  return (
    <ScrollShadowX>
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <th className="px-4 py-2.5">Nombre</th>
            <th className="px-4 py-2.5">Key</th>
            <th className="px-4 py-2.5 text-right">Límite/min</th>
            <th className="px-4 py-2.5">Último uso</th>
            <th className="px-4 py-2.5">Estado</th>
            <th className="px-4 py-2.5" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {keys.map((k) => (
            <tr key={k.id} className="hover:bg-institucional-50/40">
              <td className="px-4 py-3 align-top">
                <div className="font-medium text-slate-900">{k.name}</div>
                {k.email && <div className="text-xs text-slate-500">{k.email}</div>}
              </td>
              <td className="px-4 py-3 align-top font-mono text-xs text-slate-500">{k.key_prefix}…</td>
              <td className="px-4 py-3 align-top text-right font-mono text-xs">{k.rate_limit_per_minute}</td>
              <td className="px-4 py-3 align-top text-xs text-slate-500">
                {k.last_used_at ? formatDateTime(k.last_used_at) : 'Nunca'}
              </td>
              <td className="px-4 py-3 align-top">
                <Badge tone={k.active ? 'success' : 'neutral'}>{k.active ? 'Activa' : 'Revocada'}</Badge>
              </td>
              <td className="px-4 py-3 align-top">
                <div className="flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    disabled={update.isPending}
                    onClick={() => update.mutate({ id: k.id, active: !k.active })}
                  >
                    {k.active ? 'Revocar' : 'Reactivar'}
                  </Button>
                  {confirmId === k.id ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      type="button"
                      disabled={del.isPending}
                      onClick={() => {
                        del.mutate(k.id);
                        setConfirmId(null);
                      }}
                    >
                      ¿Seguro? Eliminar
                    </Button>
                  ) : (
                    <Button variant="ghost" size="sm" type="button" onClick={() => setConfirmId(k.id)}>
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
