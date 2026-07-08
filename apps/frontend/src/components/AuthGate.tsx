import { type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAdminSession } from '../api/admin-queries';
import { Spinner } from './ui';

/**
 * Wraps the whole app: nothing renders for an unauthenticated visitor except
 * the login page itself. There's only one account (the admin's), so "logged
 * in" and "allowed to see the site" are the same thing — this isn't a
 * multi-tenant login, it's a single door.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const location = useLocation();
  const session = useAdminSession();

  if (location.pathname === '/admin/login') return <>{children}</>;

  if (session.isLoading) {
    return (
      <div className="flex min-h-full items-center justify-center gap-2 py-24 text-sm text-slate-500">
        <Spinner className="h-5 w-5 text-institucional" /> Verificando sesión…
      </div>
    );
  }

  if (!session.data?.authenticated) {
    // Remember where the visitor was headed so login can return them there.
    return <Navigate to="/admin/login" state={{ from: location.pathname }} replace />;
  }

  return <>{children}</>;
}
