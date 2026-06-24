import { type ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import clsx from 'clsx';

interface LayoutProps {
  children: ReactNode;
}

const navItems = [
  { to: '/', label: 'Inicio', end: true },
  { to: '/oportunidades', label: 'Oportunidades', end: false },
  { to: '/mercado', label: 'Mercado', end: false },
  { to: '/proveedores', label: 'Proveedores', end: false },
  { to: '/analytics', label: 'Analytics', end: false },
];

/**
 * Top-level chrome for the portal. Header carries the institutional wine band
 * (Compras MX #611232) and primary nav; main content scrolls underneath.
 */
export function Layout({ children }: LayoutProps) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="bg-institucional text-white shadow-md">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <Link to="/" className="flex items-center gap-3 hover:opacity-90">
            <span className="grid h-9 w-9 place-items-center rounded bg-white/15 text-lg font-bold">TL</span>
            <span>
              <span className="block text-base font-semibold leading-tight">Portal de Licitaciones</span>
              <span className="block text-xs text-white/70">Tecnolicity · Transparencia</span>
            </span>
          </Link>
          <nav className="flex gap-1">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  clsx(
                    'rounded-md px-3 py-1.5 text-sm font-medium transition',
                    isActive
                      ? 'bg-white text-institucional'
                      : 'text-white/85 hover:bg-white/10 hover:text-white',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">{children}</main>
      <footer className="border-t border-slate-200 bg-white py-4 text-center text-xs text-slate-500">
        Datos públicos de ComprasMX · {new Date().getFullYear()} Tecnolicity
      </footer>
    </div>
  );
}
