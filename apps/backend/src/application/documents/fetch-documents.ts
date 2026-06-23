import type { QueueInterface } from '../../domain/queue/queue-interface.js';
import type { DocFetcher } from '../../domain/documents/doc-fetcher.js';
import type {
  DocumentRepository,
  DocumentRecord,
  UpsertDocumentInput,
} from '../../domain/repositories/document-repository.js';

/**
 * Use case: fetch a procedure's documents on demand, cache-first (DF-1).
 *
 * Flow:
 *  1. Resolve the procedure (→ null = 404 at the route).
 *  2. Cache hit (≥1 `fetched` row) → return cached, do NOT launch Playwright.
 *  3. Cache miss → run the DocFetcher through the QueueInterface (serialized +
 *     rate-limited → isolated from the query/analytics API, DF-5/DF-7) with a
 *     wall-clock timeout. Persist the outcome so the next call is a cache hit.
 *
 * reCAPTCHA (DF-6): a `captcha_blocked` outcome is persisted as a single marker
 * row and surfaced gracefully (200, not 500). It does NOT count as a cache hit
 * for the success path, so the user's "retry" re-attempts instead of serving a
 * stale block forever.
 *
 * Timeout: the fetcher has its own internal timeout; this use case wraps the
 * whole queue wait + fetch in a wall-clock budget. If it elapses we return
 * `timeout` — the in-flight task keeps running and persists when it finishes, so
 * a later GET still sees the result.
 */
export type FetchDocumentsStatus =
  | 'cached' // DF-1: served from cache, Playwright not launched
  | 'fetched' // fresh fetch completed
  | 'captcha_blocked' // DF-6: reCAPTCHA refused the session
  | 'failed' // page could not be loaded
  | 'no_anexos' // page loaded but exposed no documents
  | 'timeout' // wall-clock budget elapsed
  | 'no_anuncio_url' // procedure has no direccion_anuncio
  | 'disabled'; // feature flag off

export interface FetchDocumentsResult {
  status: FetchDocumentsStatus;
  documents: DocumentRecord[];
  message?: string;
}

export interface FetchDocumentsDeps {
  documents: DocumentRepository;
  fetcher: DocFetcher;
  queue: QueueInterface;
  /** Feature flag (DOCS_FETCH_ENABLED). When false the endpoint is a no-op. */
  enabled: boolean;
  /** Wall-clock budget for queue wait + fetch (DOCS_FETCH_TIMEOUT_MS). */
  timeoutMs: number;
}

/** Marker error used only to detect the timeout race. */
class FetchTimeoutMarker extends Error {
  constructor() {
    super('fetch timeout');
    this.name = 'FetchTimeoutMarker';
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let handle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    handle = setTimeout(() => reject(new FetchTimeoutMarker()), ms);
  });
  return Promise.race([p.finally(() => clearTimeout(handle)), timeout]);
}

export class FetchDocuments {
  constructor(private readonly deps: FetchDocumentsDeps) {}

  /**
   * Drive a document fetch for `numeroProcedimiento`. Returns null when the
   * procedure itself is unknown (route answers 404 in that case).
   */
  async execute(numeroProcedimiento: string): Promise<FetchDocumentsResult | null> {
    const proc = await this.deps.documents.getProcedureFetchInfo(numeroProcedimiento);
    if (!proc) return null;

    if (!this.deps.enabled) {
      return {
        status: 'disabled',
        documents: [],
        message: 'La obtención de documentos está deshabilitada.',
      };
    }

    if (!proc.direccionAnuncio) {
      return {
        status: 'no_anuncio_url',
        documents: [],
        message: 'Este procedimiento no tiene dirección de anuncio registrada.',
      };
    }

    // --- Cache-first (DF-1): a prior SUCCESSFUL fetch is served immediately ---
    const cached = await this.deps.documents.getByProcedure(proc.id);
    if (cached.some((d) => d.estatus === 'fetched')) {
      return { status: 'cached', documents: cached };
    }

    // --- Cache miss (or only captcha_blocked/failed markers): run the worker ---
    const task = () =>
      this.deps.queue.run(async () => {
        const outcome = await this.deps.fetcher.fetch({
          procedureId: proc.id,
          url: proc.direccionAnuncio!,
        });
        await this.persist(proc.id, outcome);
        // Re-read so we return exactly what was stored (with ids).
        return this.deps.documents.getByProcedure(proc.id);
      });

    try {
      const stored = await withTimeout(task(), this.deps.timeoutMs);
      return {
        status: this.deriveStatus(stored),
        documents: stored,
      };
    } catch (err) {
      if (err instanceof FetchTimeoutMarker) {
        return {
          status: 'timeout',
          documents: cached,
          message: `La obtención de documentos superó el tiempo máximo (${this.deps.timeoutMs}ms). Intentá nuevamente.`,
        };
      }
      throw err;
    }
  }

  /**
   * Persist a fetch outcome, replacing any prior rows for the procedure so stale
   * captcha/failed markers never linger after a successful re-fetch.
   */
  private async persist(
    procedureId: number,
    outcome: Awaited<ReturnType<DocFetcher['fetch']>>,
  ): Promise<void> {
    await this.deps.documents.deleteForProcedure(procedureId);

    if (outcome.status === 'fetched' && outcome.documents.length > 0) {
      const rows: UpsertDocumentInput[] = outcome.documents.map((d) => ({
        procedureId,
        titulo: d.titulo,
        tipo: d.tipo,
        urlFuente: d.urlFuente,
        archivoLocal: d.archivoLocal,
        storageRef: d.storageRef,
        estatus: d.estatus,
        error: d.error ?? null,
      }));
      await this.deps.documents.upsertMany(rows);
      return;
    }

    if (outcome.status === 'captcha_blocked') {
      await this.deps.documents.upsert({
        procedureId,
        titulo: null,
        tipo: null,
        urlFuente: null,
        archivoLocal: null,
        storageRef: null,
        estatus: 'captcha_blocked',
        error: outcome.error ?? 'reCAPTCHA bloqueó la obtención',
      });
      return;
    }

    if (outcome.status === 'failed') {
      await this.deps.documents.upsert({
        procedureId,
        titulo: null,
        tipo: null,
        urlFuente: null,
        archivoLocal: null,
        storageRef: null,
        estatus: 'failed',
        error: outcome.error ?? 'no se pudo cargar el anuncio',
      });
      return;
    }

    // 'no_anexos' → nothing to persist; next call re-attempts.
  }

  /** Derive the use-case status from whatever is now stored. */
  private deriveStatus(rows: DocumentRecord[]): FetchDocumentsStatus {
    if (rows.length === 0) return 'no_anexos';
    if (rows.some((r) => r.estatus === 'captcha_blocked')) return 'captcha_blocked';
    if (rows.every((r) => r.estatus === 'failed')) return 'failed';
    return 'fetched';
  }
}
