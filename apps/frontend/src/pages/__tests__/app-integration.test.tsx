import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProcedureListPage } from '../ProcedureListPage';
import { ProcedureDetailPage } from '../ProcedureDetailPage';
import { AnalyticsPage } from '../AnalyticsPage';
import { Layout } from '../../components/Layout';
import type {
  ProcedureListPage as ProcedureListPageDTO,
  ProcedureDetail,
  AnalyticsSummary,
  TipoContratacionResult,
} from '../../types';

/**
 * Build a fully-wrapped tree with isolated QueryClient + MemoryRouter at the
 * requested initial URL. Tests run against real React + Tailwind + recharts
 * (no mock-components), so this validates the whole rendering pipeline.
 */
function treeAt(route: string) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[route]}>
        <Layout>
          <Routes>
            <Route path="/" element={<ProcedureListPage />} />
            <Route path="/procedimientos/:numeroProcedimiento" element={<ProcedureDetailPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
          </Routes>
        </Layout>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const sampleList: ProcedureListPageDTO = {
  data: [
    {
      id: 1,
      numero_procedimiento: 'IA-0123-2026',
      descripcion: 'Compra de equipos de cómputo para oficina central',
      caracter: 'NACIONAL',
      tipo_contratacion: 'ADQUISICIONES',
      tipo_procedimiento: 'LICITACIÓN PÚBLICA',
      ley: 'LAASSP',
      estatus: 'PUBLICADO',
      fecha_publicacion: '2026-01-15T10:00:00.000Z',
      fecha_apertura: '2026-02-01T10:00:00.000Z',
      fecha_fallo: null,
      importe_total: 1500000,
      institucion: { nombre: 'Secretaría de Ejemplo', clave: 'SE001', siglas: 'SE' },
      unidad_compradora: { nombre: 'UC Central', clave: 'SE001001' },
    },
  ],
  pagination: { page: 1, page_size: 20, total: 1, total_pages: 1 },
};

const sampleDetail: ProcedureDetail = {
  id: 1,
  numero_procedimiento: 'IA-0123-2026',
  descripcion: 'Compra de equipos de cómputo',
  caracter: 'NACIONAL',
  tipo_contratacion: 'ADQUISICIONES',
  tipo_procedimiento: 'LICITACIÓN PÚBLICA',
  ley: 'LAASSP',
  estatus: 'PUBLICADO',
  forma_participacion: 'ELECTRÓNICA',
  fecha_publicacion: '2026-01-15T10:00:00.000Z',
  fecha_apertura: '2026-02-01T10:00:00.000Z',
  fecha_fallo: null,
  direccion_anuncio: 'https://comprasmx.buengobierno.gob.test/anuncio/123',
  contrato_marco: false,
  compra_consolidada: true,
  credito_externo: null,
  institucion: {
    clave: 'SE001',
    nombre: 'Secretaría de Ejemplo',
    siglas: 'SE',
    orden_gobierno: 'APF',
    clave_ramo: '01',
    descripcion_ramo: 'Ejemplo',
  },
  unidad_compradora: { clave: 'SE001001', nombre: 'UC Central' },
  expedientes: [{ codigo_expediente: 'E-001', referencia: 'R-001', titulo: 'Expediente 1', partida_especifica: '1' }],
  contracts: [
    {
      id: 100,
      codigo_contrato: 'C-001',
      numero_contrato: 'N-001',
      titulo: 'Contrato principal',
      descripcion: 'Suministro de equipos',
      importe_drc: 1500000,
      moneda: 'MXN',
      estatus_drc: 'PUBLICADO',
      tipo_contrato: 'BIENES',
      contrato_plurianual: false,
      convenio_modificatorio: false,
      fecha_inicio: '2026-02-15',
      fecha_fin: '2026-12-31',
      fecha_firma: '2026-02-10',
      supplier: { rfc: 'ABC123456789', nombre: 'Proveedor SA de CV', folio_rupc: '1', pais: 'México', estratificacion: 'PYME' },
      amounts: [
        {
          tipo: 'original',
          monto_sin_imp_min: 1300000,
          monto_con_imp_min: 1500000,
          monto_sin_imp_max: 1300000,
          monto_con_imp_max: 1500000,
          moneda: 'MXN',
          codigo_ref: 'CR-1',
          fecha_fin_convenio: null,
        },
      ],
    },
  ],
};

const sampleSummary: AnalyticsSummary = {
  total_monto: 1000000000,
  total_procedimientos: 500,
  total_contratos: 700,
  monto_promedio: 2000000,
  distribucion_montos: { menor_100k: 100, entre_100k_1m: 200, entre_1m_10m: 150, mayor_10m: 50 },
  por_estatus: [{ estatus: 'PUBLICADO', total: 500 }],
};

const sampleTipo: TipoContratacionResult = {
  por_tipo_contratacion: [
    { clave: 'ADQUISICIONES', total_monto: 600000000, total_procedimientos: 300, total_contratos: 400 },
    { clave: 'SERVICIOS', total_monto: 400000000, total_procedimientos: 200, total_contratos: 300 },
  ],
  por_tipo_procedimiento: [{ clave: 'LICITACIÓN PÚBLICA', total_monto: 800000000, total_procedimientos: 400, total_contratos: 600 }],
};

beforeEach(() => {
  vi.restoreAllMocks();
});

function mockFetch(map: Record<string, unknown>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0] ?? '';
    const body = map[path];
    if (body === undefined) {
      return new Response(JSON.stringify({ error: 'not_found', message: path }), { status: 404 });
    }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('ProcedureListPage', () => {
  it('renders procedures from API and shows total count', async () => {
    mockFetch({ '/api/procedures': sampleList });
    render(treeAt('/'));

    // Header is in the layout, always present
    expect(screen.getByText('Portal de Licitaciones')).toBeInTheDocument();

    // Row appears once data loads
    await waitFor(() => {
      expect(screen.getByText('IA-0123-2026')).toBeInTheDocument();
    });
    expect(screen.getByText(/Secretaría de Ejemplo/)).toBeInTheDocument();
    expect(screen.getByText(/1 resultados/)).toBeInTheDocument();
  });

  it('shows the empty state when no results', async () => {
    mockFetch({
      '/api/procedures': { data: [], pagination: { page: 1, page_size: 20, total: 0, total_pages: 0 } },
    });
    render(treeAt('/'));
    await waitFor(() => {
      expect(screen.getByText('No se encontraron procedimientos')).toBeInTheDocument();
    });
  });
});

describe('ProcedureDetailPage', () => {
  it('renders full detail with contracts and supplier', async () => {
    mockFetch({
      '/api/procedures/IA-0123-2026': sampleDetail,
      '/api/procedures/IA-0123-2026/documents': { data: [] },
    });
    render(treeAt('/procedimientos/IA-0123-2026'));

    await waitFor(() => {
      expect(screen.getByText('Compra de equipos de cómputo')).toBeInTheDocument();
    });

    // Procedure number + estatus badges (estatus appears in the header AND in
    // contract estatus_drc — assert at least one occurrence).
    expect(screen.getByText('IA-0123-2026')).toBeInTheDocument();
    expect(screen.getAllByText('PUBLICADO').length).toBeGreaterThan(0);

    // Contracts section — 'Contrato principal' is the contract title
    expect(screen.getByText('Contrato principal')).toBeInTheDocument();
    // Supplier name appears in both SuppliersCard and the contract's Proveedor detail
    expect(screen.getAllByText('Proveedor SA de CV').length).toBeGreaterThan(0);

    // Documents section offers the fetch button + the official URL link (UI-3).
    // (findByRole waits for the documents query to resolve before the button appears.)
    expect(await screen.findByRole('button', { name: /Obtener documentos/ })).toBeInTheDocument();
    expect(screen.getByText(/Ver en sitio oficial/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Ver en sitio oficial/ })).toHaveAttribute(
      'href',
      'https://comprasmx.buengobierno.gob.test/anuncio/123',
    );
  });

  it('fetches documents on demand and shows them after success (UI-3)', async () => {
    const user = userEvent.setup();
    mockFetch({
      '/api/procedures/IA-0123-2026': sampleDetail,
      '/api/procedures/IA-0123-2026/documents': { data: [] },
      '/api/procedures/IA-0123-2026/documents/fetch': {
        status: 'fetched',
        documents: [
          {
            id: 501,
            titulo: 'Bases de licitación.pdf',
            tipo: 'PDF',
            url_fuente: 'https://comprasmx.test/bases.pdf',
            archivo_local: 'Bases_de_licitacion.pdf',
            fecha_descarga: '2026-06-23T10:00:00.000Z',
            estatus: 'fetched',
            download_url: '/api/procedures/IA-0123-2026/documents/501/download',
          },
        ],
      },
    });
    render(treeAt('/procedimientos/IA-0123-2026'));

    const button = await screen.findByRole('button', { name: /Obtener documentos/ });
    await user.click(button);

    // The fetch POST returns the documents; setQueryData writes them to the
    // documents cache → the list re-renders with the freshly-fetched anexo.
    await waitFor(() => {
      expect(screen.getByText('Bases de licitación.pdf')).toBeInTheDocument();
    });
    // Download link appears because archivo_local is set.
    expect(screen.getByRole('link', { name: /Descargar/ })).toBeInTheDocument();
  });

  it('shows a graceful captcha-blocked notice with retry (DF-6, UI-4)', async () => {
    const user = userEvent.setup();
    mockFetch({
      '/api/procedures/IA-0123-2026': sampleDetail,
      '/api/procedures/IA-0123-2026/documents': { data: [] },
      '/api/procedures/IA-0123-2026/documents/fetch': {
        status: 'captcha_blocked',
        documents: [],
        message: 'ComprasMX rechazó la solicitud (reCAPTCHA v3).',
      },
    });
    render(treeAt('/procedimientos/IA-0123-2026'));

    const button = await screen.findByRole('button', { name: /Obtener documentos/ });
    await user.click(button);

    await waitFor(() => {
      expect(screen.getByText(/ComprasMX rechazó la solicitud/)).toBeInTheDocument();
    });
    // Retry action available (DF-6 allow retry).
    expect(screen.getByRole('button', { name: /Reintentar/ })).toBeInTheDocument();
  });

  it('renders 404 empty state for unknown procedure', async () => {
    mockFetch({}); // every path returns 404
    render(treeAt('/procedimientos/DOES-NOT-EXIST'));
    await waitFor(() => {
      expect(screen.getByText(/No existe el procedimiento/)).toBeInTheDocument();
    });
  });
});

describe('AnalyticsPage', () => {
  it('renders summary cards and chart titles', async () => {
    mockFetch({
      '/api/analytics/summary': sampleSummary,
      '/api/analytics/by-institucion': { data: [] },
      '/api/analytics/by-tipo-contratacion': sampleTipo,
      '/api/analytics/top-proveedores': { data: [] },
    });
    render(treeAt('/analytics'));

    await waitFor(() => {
      expect(screen.getByText('Costos y estadísticas')).toBeInTheDocument();
    });

    // Summary cards (the labels are uppercase-tracked)
    expect(screen.getByText('Total monto')).toBeInTheDocument();
    expect(screen.getByText('Procedimientos')).toBeInTheDocument();
    expect(screen.getByText('Contratos')).toBeInTheDocument();

    // Chart card titles
    expect(screen.getByText('Top instituciones por monto')).toBeInTheDocument();
    expect(screen.getByText('Monto por tipo de contratación')).toBeInTheDocument();
    expect(screen.getByText('Top proveedores por monto')).toBeInTheDocument();
    expect(screen.getByText('Distribución por estatus')).toBeInTheDocument();
  });
});

describe('Layout navigation', () => {
  it('links Inicio and Analytics from the header', async () => {
    mockFetch({ '/api/procedures': sampleList });
    render(treeAt('/'));
    const nav = screen.getByRole('navigation');
    expect(within(nav).getByText('Inicio')).toBeInTheDocument();
    expect(within(nav).getByText('Analytics')).toBeInTheDocument();
  });
});

describe('formatCurrency integration', () => {
  it('formats amounts in MXN inside the table', async () => {
    mockFetch({ '/api/procedures': sampleList });
    render(treeAt('/'));
    await waitFor(() => {
      expect(screen.getByText('IA-0123-2026')).toBeInTheDocument();
    });
    // importe_total = 1,500,000 → compact format like "$1.5 M"
    const cell = screen.getByText(/\$/);
    expect(cell).toBeInTheDocument();
  });
});
