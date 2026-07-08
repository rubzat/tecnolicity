import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAdminLogin, useAdminSession } from '../api/admin-queries';
import { ApiRequestError } from '../api/client';
import { Button, Card, ErrorBanner, Spinner } from '../components/ui';

/**
 * Admin login — gates the whole portal (single account; there's no public
 * area anymore). Returns the visitor to wherever AuthGate intercepted them,
 * falling back to the homepage.
 */
export function AdminLoginPage() {
  const session = useAdminSession();
  const login = useAdminLogin();
  const navigate = useNavigate();
  const location = useLocation();
  const destination = (location.state as { from?: string } | null)?.from ?? '/';
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  if (session.data?.authenticated) {
    return <Navigate to={destination} replace />;
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    login.mutate(
      { username, password },
      { onSuccess: () => navigate(destination, { replace: true }) },
    );
  }

  return (
    <div className="mx-auto max-w-sm py-10">
      <div className="mb-6 text-center">
        <h1 className="font-display text-2xl font-semibold text-slate-900">Portal de Licitaciones</h1>
        <p className="mt-1 text-sm text-slate-500">Acceso restringido — inicia sesión para continuar.</p>
      </div>
      <Card className="p-6">
        <form className="space-y-4" onSubmit={onSubmit}>
          {login.isError && (
            <ErrorBanner
              message={
                login.error instanceof ApiRequestError
                  ? login.error.displayMessage
                  : 'No se pudo iniciar sesión.'
              }
            />
          )}
          <div>
            <label htmlFor="username" className="mb-1 block text-xs font-medium text-slate-600">
              Usuario
            </label>
            <input
              id="username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-institucional focus:outline-none focus:ring-1 focus:ring-institucional"
              required
            />
          </div>
          <div>
            <label htmlFor="password" className="mb-1 block text-xs font-medium text-slate-600">
              Contraseña
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-institucional focus:outline-none focus:ring-1 focus:ring-institucional"
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={login.isPending}>
            {login.isPending ? <Spinner className="h-4 w-4" /> : 'Entrar'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
