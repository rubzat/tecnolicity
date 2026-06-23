/**
 * DocFetcher — domain port for the on-demand Playwright document worker.
 *
 * The application layer (`FetchDocuments` use case) depends on THIS interface.
 * The Playwright implementation lives in `infrastructure/documents/`; tests
 * inject a fake. This keeps the reCAPTCHA-sensitive scraping detail out of the
 * application core and makes the cache-first flow unit-testable.
 *
 * Contract semantics (spec document-fetching DF-3, DF-6, DF-8):
 * - `fetched`     → the Angular page loaded, anexos were extracted; per-file
 *                   downloads may still be partial (each `documents[].estatus`
 *                   distinguishes `fetched` vs `failed`).
 * - `captcha_blocked` → reCAPTCHA v3 refused the session (#213). No documents.
 * - `failed`      → the page could not be loaded at all (navigation/timeout
 *                   before any anexos were seen).
 * - `no_anexos`   → the page loaded cleanly but exposed zero documents.
 */

/** A single extracted anexo, possibly with its file downloaded locally. */
export interface ExtractedDocument {
  titulo: string;
  tipo: string | null;
  /** Original source URL (ComprasMX anexo link). */
  urlFuente: string;
  /** Local filename within storage (null when the file could not be saved). */
  archivoLocal: string | null;
  /** Storage adapter reference (null when not downloaded). */
  storageRef: string | null;
  /** Per-file outcome (DF-8 partial download). */
  estatus: 'fetched' | 'failed';
  error?: string;
}

export type FetchStatus = 'fetched' | 'captcha_blocked' | 'failed' | 'no_anexos';

export interface FetchOutcome {
  status: FetchStatus;
  documents: ExtractedDocument[];
  /** Human-readable detail (present on non-`fetched` outcomes). */
  error?: string;
  /** Which browser mode produced this result (documented for ops). */
  mode: 'headless' | 'non-headless';
}

/** Input the Playwright worker needs beyond the URL itself. */
export interface FetchRequest {
  procedureId: number;
  /** The procedure's `direccion_anuncio` — the Angular SPA entry URL. */
  url: string;
}

export interface DocFetcher {
  fetch(req: FetchRequest): Promise<FetchOutcome>;
}
