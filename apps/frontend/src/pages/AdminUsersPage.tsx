import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import {
  useAdminSession,
  useUsers,
  useCreateUser,
  useUpdateUser,
  useDeleteUser,
} from '../api/admin-queries';
import { ApiRequestError } from '../api/client';
import type { UserSummary } from '../types';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBanner, Skeleton, Spinner } from '../components/ui';
import { ScrollShadowX } from '../components/ScrollShadowX';
import { formatDateTime } from '../utils/format';

/**
 * Admin panel: manage login accounts. All accounts are equal (no roles) —
 * this just replaces the old single env-based admin with a proper table.
 * The signed-in user's own row can't be deactivated/deleted here; the
 * backend enforces the same "last active user" guard independently.
 */
export function AdminUsersPage() {
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
  return <UsersManager currentUserId={session.data.user_id} />;
}

function UsersManager({ currentUserId }: { currentUserId: number | null }) {
  const users = useUsers();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-xl font-semibold text-slate-900">Usuarios</h1>
        <p className="text-sm text-slate-500">
          Cuentas con acceso al panel de administración. Todas tienen los mismos permisos.
        </p>
      </div>

      <Card>
        <CardHeader title="Nuevo usuario" subtitle="Nombre de usuario y contraseña (mínimo 8 caracteres)" />
        <div className="p-4">
          <CreateUserForm />
        </div>
      </Card>

      <Card>
        <CardHeader title="Cuentas" subtitle={users.data ? `${users.data.data.length} en total` : undefined} />
        {users.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : users.isError ? (
          <div className="p-4">
            <ErrorBanner message="No se pudieron cargar los usuarios." onRetry={() => void users.refetch()} />
          </div>
        ) : users.data!.data.length === 0 ? (
          <EmptyState title="Sin usuarios" hint="Crea el primero arriba." />
        ) : (
          <UsersTable users={users.data!.data} currentUserId={currentUserId} />
        )}
      </Card>
    </div>
  );
}

function CreateUserForm() {
  const create = useCreateUser();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!username.trim() || password.length < 8) return;
    create.mutate(
      { username: username.trim(), password },
      {
        onSuccess: () => {
          setUsername('');
          setPassword('');
        },
      },
    );
  }

  const errorMessage =
    create.error instanceof ApiRequestError && create.error.status === 409
      ? 'Ese nombre de usuario ya existe.'
      : 'No se pudo crear el usuario. Revisa los datos (contraseña mínimo 8 caracteres).';

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
      {create.isError && (
        <div className="w-full">
          <ErrorBanner message={errorMessage} />
        </div>
      )}
      <div className="min-w-[12rem] flex-1">
        <label className="mb-1 block text-xs font-medium text-slate-600">Usuario *</label>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="nombre.usuario"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-institucional focus:outline-none focus:ring-1 focus:ring-institucional"
          required
        />
      </div>
      <div className="min-w-[12rem] flex-1">
        <label className="mb-1 block text-xs font-medium text-slate-600">Contraseña *</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Mínimo 8 caracteres"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-institucional focus:outline-none focus:ring-1 focus:ring-institucional"
          required
          minLength={8}
        />
      </div>
      <Button type="submit" disabled={create.isPending || !username.trim() || password.length < 8}>
        {create.isPending ? <Spinner className="h-4 w-4" /> : 'Crear usuario'}
      </Button>
    </form>
  );
}

function UsersTable({ users, currentUserId }: { users: UserSummary[]; currentUserId: number | null }) {
  const update = useUpdateUser();
  const del = useDeleteUser();
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [resetId, setResetId] = useState<number | null>(null);

  return (
    <ScrollShadowX>
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <th className="px-4 py-2.5">Usuario</th>
            <th className="px-4 py-2.5">Último acceso</th>
            <th className="px-4 py-2.5">Estado</th>
            <th className="px-4 py-2.5" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {users.map((u) => {
            const isSelf = u.id === currentUserId;
            return (
              <tr key={u.id} className="hover:bg-institucional-50/40">
                <td className="px-4 py-3 align-top">
                  <div className="font-medium text-slate-900">
                    {u.username} {isSelf && <span className="text-xs font-normal text-slate-400">(tú)</span>}
                  </div>
                </td>
                <td className="px-4 py-3 align-top text-xs text-slate-500">
                  {u.last_login_at ? formatDateTime(u.last_login_at) : 'Nunca'}
                </td>
                <td className="px-4 py-3 align-top">
                  <Badge tone={u.active ? 'success' : 'neutral'}>{u.active ? 'Activo' : 'Desactivado'}</Badge>
                </td>
                <td className="px-4 py-3 align-top">
                  <div className="flex justify-end gap-2">
                    {resetId === u.id ? (
                      <ResetPasswordForm
                        userId={u.id}
                        onDone={() => setResetId(null)}
                        onCancel={() => setResetId(null)}
                      />
                    ) : (
                      <>
                        <Button variant="ghost" size="sm" type="button" onClick={() => setResetId(u.id)}>
                          Cambiar contraseña
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          type="button"
                          disabled={update.isPending || isSelf}
                          title={isSelf ? 'No puedes desactivar tu propia cuenta' : undefined}
                          onClick={() => update.mutate({ id: u.id, active: !u.active })}
                        >
                          {u.active ? 'Desactivar' : 'Reactivar'}
                        </Button>
                        {confirmId === u.id ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            type="button"
                            disabled={del.isPending}
                            onClick={() => {
                              del.mutate(u.id);
                              setConfirmId(null);
                            }}
                          >
                            ¿Seguro? Eliminar
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            type="button"
                            disabled={isSelf}
                            title={isSelf ? 'No puedes eliminar tu propia cuenta' : undefined}
                            onClick={() => setConfirmId(u.id)}
                          >
                            Eliminar
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </ScrollShadowX>
  );
}

function ResetPasswordForm({
  userId,
  onDone,
  onCancel,
}: {
  userId: number;
  onDone: () => void;
  onCancel: () => void;
}) {
  const update = useUpdateUser();
  const [password, setPassword] = useState('');

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) return;
    update.mutate({ id: userId, password }, { onSuccess: onDone });
  }

  return (
    <form onSubmit={onSubmit} className="flex items-center gap-2">
      <input
        type="password"
        autoFocus
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Nueva contraseña"
        minLength={8}
        className="w-40 rounded-md border border-slate-300 px-2 py-1.5 text-xs focus:border-institucional focus:outline-none focus:ring-1 focus:ring-institucional"
      />
      <Button type="submit" size="sm" disabled={update.isPending || password.length < 8}>
        {update.isPending ? <Spinner className="h-3 w-3" /> : 'Guardar'}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
        Cancelar
      </Button>
    </form>
  );
}
