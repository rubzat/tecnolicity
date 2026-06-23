import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layout } from './components/Layout';
import { ProcedureListPage } from './pages/ProcedureListPage';
import { ProcedureDetailPage } from './pages/ProcedureDetailPage';
import { AnalyticsPage } from './pages/AnalyticsPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

/**
 * Root application: providers (QueryClient + Router) and route table.
 *
 * Routes:
 * - `/`                         → list page
 * - `/procedimientos/:numero`   → detail page
 * - `/analytics`                → analytics dashboard
 * - everything else             → redirect to `/`
 */
export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Layout>
          <Routes>
            <Route path="/" element={<ProcedureListPage />} />
            <Route path="/procedimientos/:numeroProcedimiento" element={<ProcedureDetailPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Layout>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
