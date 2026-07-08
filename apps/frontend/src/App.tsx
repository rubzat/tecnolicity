import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layout } from './components/Layout';
import { ProcedureListPage } from './pages/ProcedureListPage';
import { Spinner } from './components/ui';

// Code-split the heavier pages (detail + analytics pull in recharts) so the
// initial list-page bundle stays slim. The list page is the landing route,
// so it's bundled eagerly.
const ProcedureDetailPage = lazy(() =>
  import('./pages/ProcedureDetailPage').then((m) => ({ default: m.ProcedureDetailPage })),
);
const AnalyticsPage = lazy(() =>
  import('./pages/AnalyticsPage').then((m) => ({ default: m.AnalyticsPage })),
);
const MarketPage = lazy(() =>
  import('./pages/MarketPage').then((m) => ({ default: m.MarketPage })),
);
const SuppliersPage = lazy(() =>
  import('./pages/SuppliersPage').then((m) => ({ default: m.SuppliersPage })),
);
const ProductsPage = lazy(() =>
  import('./pages/ProductsPage').then((m) => ({ default: m.ProductsPage })),
);
const OpportunitiesPage = lazy(() =>
  import('./pages/OpportunitiesPage').then((m) => ({ default: m.OpportunitiesPage })),
);
const AdminLoginPage = lazy(() =>
  import('./pages/AdminLoginPage').then((m) => ({ default: m.AdminLoginPage })),
);
const AdminApiKeysPage = lazy(() =>
  import('./pages/AdminApiKeysPage').then((m) => ({ default: m.AdminApiKeysPage })),
);
const ApiDocsPage = lazy(() => import('./pages/ApiDocsPage').then((m) => ({ default: m.ApiDocsPage })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

/** Loading fallback for lazy routes. */
function RouteFallback({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
      <Spinner className="h-5 w-5 text-institucional" /> {children}
    </div>
  );
}

/**
 * Root application: providers (QueryClient + Router) and route table.
 *
 * Routes:
 * - `/`                         → list page (eager)
 * - `/oportunidades`            → currently-open vigente bids (lazy)
 * - `/mercado`                  → market intelligence dashboard (lazy)
 * - `/proveedores`              → supplier intelligence (search + profile) (lazy)
 * - `/productos`                → product price intelligence (lazy)
 * - `/procedimientos/:numero`   → detail page (lazy)
 * - `/analytics`                → analytics dashboard (lazy)
 * - everything else             → redirect to `/`
 */
export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Layout>
          <Routes>
            <Route path="/" element={<ProcedureListPage />} />
            <Route
              path="/oportunidades"
              element={
                <Suspense fallback={<RouteFallback>Cargando oportunidades…</RouteFallback>}>
                  <OpportunitiesPage />
                </Suspense>
              }
            />
            <Route
              path="/mercado"
              element={
                <Suspense fallback={<RouteFallback>Cargando inteligencia de mercado…</RouteFallback>}>
                  <MarketPage />
                </Suspense>
              }
            />
            <Route
              path="/proveedores"
              element={
                <Suspense fallback={<RouteFallback>Cargando proveedores…</RouteFallback>}>
                  <SuppliersPage />
                </Suspense>
              }
            />
            <Route
              path="/productos"
              element={
                <Suspense fallback={<RouteFallback>Cargando productos…</RouteFallback>}>
                  <ProductsPage />
                </Suspense>
              }
            />
            <Route
              path="/procedimientos/:numeroProcedimiento"
              element={
                <Suspense fallback={<RouteFallback>Cargando procedimiento…</RouteFallback>}>
                  <ProcedureDetailPage />
                </Suspense>
              }
            />
            <Route
              path="/analytics"
              element={
                <Suspense fallback={<RouteFallback>Cargando analíticas…</RouteFallback>}>
                  <AnalyticsPage />
                </Suspense>
              }
            />
            <Route
              path="/docs"
              element={
                <Suspense fallback={<RouteFallback>Cargando documentación…</RouteFallback>}>
                  <ApiDocsPage />
                </Suspense>
              }
            />
            <Route
              path="/admin/login"
              element={
                <Suspense fallback={<RouteFallback>Cargando…</RouteFallback>}>
                  <AdminLoginPage />
                </Suspense>
              }
            />
            <Route
              path="/admin/api-keys"
              element={
                <Suspense fallback={<RouteFallback>Cargando…</RouteFallback>}>
                  <AdminApiKeysPage />
                </Suspense>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Layout>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
