import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import clsx from 'clsx';
import { pageVariants } from '../lib/motion';
import { useAdminSession, useAdminLogout } from '../api/admin-queries';
import { Button } from './ui';

interface LayoutProps {
  children: ReactNode;
}

const navItems = [
  { to: '/', label: 'Inicio', end: true },
  { to: '/oportunidades', label: 'Oportunidades', end: false },
  { to: '/mercado', label: 'Mercado', end: false },
  { to: '/productos', label: 'Productos', end: false },
  { to: '/proveedores', label: 'Proveedores', end: false },
  { to: '/analytics', label: 'Analytics', end: false },
  { to: '/docs', label: 'API', end: false },
  { to: '/admin/api-keys', label: 'API keys', end: false },
];

/**
 * Top-level chrome for the portal. Header carries the institutional wine band
 * (Compras MX #611232) and primary nav; main content scrolls underneath.
 */
export function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const session = useAdminSession();
  const logout = useAdminLogout();
  // Nav/logout only make sense once past the login gate — on /admin/login
  // (or mid-redirect-to-login) show just the brand bar.
  const showNav = location.pathname !== '/admin/login' && session.data?.authenticated === true;

  // Close the mobile menu on every navigation.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  return (
    <div className="flex min-h-full flex-col">
      <header className="relative bg-institucional text-white shadow-md">
        {/* Subtle depth instead of a flat fill — a soft diagonal lift, not a gradient trend piece. */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'linear-gradient(115deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0) 35%), linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.12) 100%)',
          }}
        />
        <div className="relative mx-auto flex max-w-7xl items-center justify-between gap-2 px-4 py-3 sm:px-6">
          <Link
            to="/"
            className="flex items-center gap-3 rounded-md hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded bg-white/15 font-display text-lg font-semibold">
              TL
            </span>
            <span className="min-w-0">
              <span className="block truncate font-display text-base font-semibold leading-tight tracking-tight">
                Portal de Licitaciones
              </span>
              <span className="block truncate text-xs text-white/70">Tecnolicity · Transparencia</span>
            </span>
          </Link>

          {showNav && (
            <>
              {/* Desktop nav */}
              <nav aria-label="Principal" className="hidden items-center gap-0.5 lg:flex xl:gap-1">
                {navItems.map((item) => {
                  const isActive =
                    item.end ? location.pathname === item.to : location.pathname.startsWith(item.to);
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      className={clsx(
                        'relative whitespace-nowrap rounded-md px-2 py-1.5 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white xl:px-3',
                        isActive ? 'text-institucional' : 'text-white/85 hover:bg-white/10 hover:text-white',
                      )}
                    >
                      {isActive && (
                        <motion.span
                          layoutId="nav-active"
                          className="absolute inset-0 rounded-md bg-white"
                          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                        />
                      )}
                      <span className="relative">{item.label}</span>
                    </NavLink>
                  );
                })}
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  onClick={() => logout.mutate()}
                  disabled={logout.isPending}
                  className="ml-1 whitespace-nowrap text-white/85 hover:bg-white/10 hover:text-white"
                >
                  Cerrar sesión
                </Button>
              </nav>

              {/* Mobile menu toggle */}
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                className="rounded-md p-2 text-white/90 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white lg:hidden"
                aria-label={menuOpen ? 'Cerrar menú' : 'Abrir menú'}
                aria-expanded={menuOpen}
              >
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  {menuOpen ? (
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                  )}
                </svg>
              </button>
            </>
          )}
        </div>

        {/* Mobile nav panel */}
        {showNav && (
          <AnimatePresence>
            {menuOpen && (
              <motion.nav
                aria-label="Principal"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                className="relative overflow-hidden border-t border-white/10 lg:hidden"
              >
                <div className="flex flex-col gap-0.5 px-4 py-2 sm:px-6">
                  {navItems.map((item) => {
                    const isActive =
                      item.end ? location.pathname === item.to : location.pathname.startsWith(item.to);
                    return (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        end={item.end}
                        className={clsx(
                          'rounded-md px-3 py-2 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white',
                          isActive ? 'bg-white text-institucional' : 'text-white/85 hover:bg-white/10 hover:text-white',
                        )}
                      >
                        {item.label}
                      </NavLink>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => logout.mutate()}
                    disabled={logout.isPending}
                    className="rounded-md px-3 py-2 text-left text-sm font-medium text-white/85 transition hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                  >
                    Cerrar sesión
                  </button>
                </div>
              </motion.nav>
            )}
          </AnimatePresence>
        )}
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
        <motion.div
          key={location.pathname}
          initial="hidden"
          animate="visible"
          variants={pageVariants}
        >
          {children}
        </motion.div>
      </main>
      <footer className="border-t border-slate-200 bg-white py-4 text-center text-xs text-slate-500">
        Datos públicos de ComprasMX · {new Date().getFullYear()} Tecnolicity
      </footer>
    </div>
  );
}
