import { useDocuments, useFetchDocuments } from '../api/queries';
import { Badge, Button, Card, CardHeader, Spinner } from './ui';
import { formatDateTime } from '../utils/format';
import type { DocumentItem, FetchDocumentsStatus } from '../types';

/**
 * On-demand documents section (UI-3, UI-4).
 *
 * Cache-first: shows cached documents if present. Otherwise offers an "Obtener
 * documentos" button that triggers the Playwright worker (POST /documents/fetch).
 * Every worker outcome is surfaced gracefully: reCAPTCHA block, timeout, partial
 * download, and no-docs all show an informative notice with a retry action —
 * never a crash (DF-6). The official ComprasMX link is always available.
 */
export function DocumentsSection({
  numeroProcedimiento,
  direccionAnuncio,
}: {
  numeroProcedimiento: string;
  direccionAnuncio: string | null;
}) {
  const docs = useDocuments(numeroProcedimiento);
  const fetchMut = useFetchDocuments(numeroProcedimiento);

  const visibleDocs = (docs.data?.data ?? []).filter((d) => d.titulo !== null);
  const fetching = fetchMut.isPending;
  // While a fetch is in flight, suppress the stale notice (loading speaks instead).
  const notice = fetching ? null : deriveNotice(fetchMut.data?.status, fetchMut.isError, fetchMut.data?.message);

  return (
    <Card>
      <CardHeader
        title="Documentos"
        subtitle={visibleDocs.length > 0 ? `${visibleDocs.length} documento(s)` : 'Bajo demanda'}
      />
      <div className="space-y-3 px-5 py-4">
        {/* Initial cache load */}
        {docs.isLoading && <SkeletonRow />}

        {/* A worker outcome worth telling the user about (captcha / timeout / …) */}
        {notice && (
          <NoticeBanner
            tone={notice.tone}
            message={notice.message}
            canRetry={notice.canRetry && !fetching && Boolean(direccionAnuncio)}
            onRetry={() => fetchMut.mutate()}
          />
        )}

        {/* Cached / freshly-fetched documents */}
        {visibleDocs.length > 0 && (
          <ul className="divide-y divide-slate-100">
            {visibleDocs.map((doc) => (
              <DocumentRow key={doc.id} doc={doc} />
            ))}
          </ul>
        )}

        {/* Fetch trigger — only when there is nothing to show and no notice yet */}
        {visibleDocs.length === 0 && !notice && !docs.isLoading && direccionAnuncio && (
          <div className="flex flex-col items-start gap-2">
            <Button
              type="button"
              onClick={() => fetchMut.mutate()}
              disabled={fetching}
            >
              {fetching ? (
                <>
                  <Spinner className="h-4 w-4" />
                  Obteniendo documentos…
                </>
              ) : (
                'Obtener documentos'
              )}
            </Button>
            <p className="text-xs text-slate-500">
              Se descargan los anexos desde Compras MX bajo demanda.
            </p>
          </div>
        )}

        {/* No anuncio URL at all */}
        {visibleDocs.length === 0 && !direccionAnuncio && !notice && (
          <p className="text-sm text-slate-500">
            Este procedimiento no tiene dirección de anuncio registrada para consulta de documentos.
          </p>
        )}

        {/* Always available: the official ComprasMX link */}
        {direccionAnuncio && (
          <p>
            <a
              href={direccionAnuncio}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm font-medium text-institucional hover:underline"
            >
              Ver en sitio oficial
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14 5h5m0 0v5m0-5l-7 7M19 14v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
              </svg>
            </a>
          </p>
        )}
      </div>
    </Card>
  );
}

function DocumentRow({ doc }: { doc: DocumentItem }) {
  const ok = doc.estatus === 'fetched';
  return (
    <li className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm text-slate-900">{doc.titulo}</span>
          {doc.tipo && <Badge tone="neutral">{doc.tipo}</Badge>}
          {!ok && <Badge tone="warning">Falló</Badge>}
        </div>
        <div className="mt-0.5 text-xs text-slate-500">
          {doc.fecha_descarga ? `Descargado ${formatDateTime(doc.fecha_descarga)}` : ''}
          {doc.error ? ` · ${doc.error}` : ''}
        </div>
      </div>
      {doc.download_url ? (
        <a
          href={doc.download_url}
          className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-institucional hover:underline"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
          </svg>
          Descargar
        </a>
      ) : doc.url_fuente && doc.url_fuente !== '(sin URL)' ? (
        <a
          href={doc.url_fuente}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-sm font-medium text-institucional hover:underline"
        >
          Abrir
        </a>
      ) : null}
    </li>
  );
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-2 py-2 text-sm text-slate-500">
      <Spinner className="h-4 w-4 text-institucional" /> Cargando documentos…
    </div>
  );
}

interface Notice {
  tone: 'warning' | 'info';
  message: string;
  canRetry: boolean;
}

/**
 * Map the latest fetch outcome to a user-facing notice. Returns null when there
 * is nothing worth telling the user (success path — the list speaks for itself).
 */
function deriveNotice(
  status: FetchDocumentsStatus | undefined,
  isError: boolean,
  serverMessage?: string,
): Notice | null {
  if (isError) {
    return {
      tone: 'warning',
      message: 'No se pudo conectar con el servidor para obtener los documentos.',
      canRetry: true,
    };
  }
  switch (status) {
    case 'captcha_blocked':
      return {
        tone: 'warning',
        message:
          serverMessage ??
          'No se pudieron obtener los documentos en este momento. Intentá nuevamente más tarde.',
        canRetry: true,
      };
    case 'failed':
      return {
        tone: 'warning',
        message: serverMessage ?? 'No se pudieron descargar los documentos. Intentá nuevamente.',
        canRetry: true,
      };
    case 'timeout':
      return {
        tone: 'warning',
        message: serverMessage ?? 'La obtención de documentos superó el tiempo máximo. Intentá nuevamente.',
        canRetry: true,
      };
    case 'no_anexos':
      return {
        tone: 'info',
        message: 'El anuncio cargó pero no expone documentos descargables.',
        canRetry: false,
      };
    case 'no_anuncio_url':
      return {
        tone: 'info',
        message: 'Este procedimiento no tiene dirección de anuncio registrada.',
        canRetry: false,
      };
    case 'disabled':
      return {
        tone: 'info',
        message: 'La obtención de documentos está deshabilitada en este momento.',
        canRetry: false,
      };
    default:
      // 'fetched' | 'cached' | undefined → no notice (the list speaks for itself).
      return null;
  }
}

function NoticeBanner({
  tone,
  message,
  canRetry,
  onRetry,
}: {
  tone: 'warning' | 'info';
  message: string;
  canRetry: boolean;
  onRetry: () => void;
}) {
  const cls =
    tone === 'warning'
      ? 'border-amber-200 bg-amber-50 text-amber-800'
      : 'border-sky-200 bg-sky-50 text-sky-800';
  return (
    <div
      role="status"
      className={`flex flex-col gap-2 rounded-md border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between ${cls}`}
    >
      <span>{message}</span>
      {canRetry && (
        <Button variant="secondary" size="sm" type="button" onClick={onRetry}>
          Reintentar
        </Button>
      )}
    </div>
  );
}
