/**
 * DocumentRepository — domain port for the `documents` table cache.
 *
 * The Playwright worker writes its results here (DF-3, DF-4); the API reads
 * cached rows here (DF-1 cache-first). Application use cases depend on THIS
 * interface, never on Drizzle.
 */

/**
 * Document fetch status — the cache row's lifecycle (task 5.4 state machine).
 *
 *   pending ──▶ fetched        (download succeeded)
 *          ──▶ failed          (download error / partial)
 *          ──▶ captcha_blocked (reCAPTCHA v3 refused the session, #213)
 *
 * Re-fetching a procedure deletes its old rows and inserts fresh ones, so a row
 * is only ever created in `fetched` / `failed` / `captcha_blocked`. The
 * transition guard below enforces the legal moves for individual rows.
 */
export type DocumentEstatus = 'pending' | 'fetched' | 'failed' | 'captcha_blocked';

/** All legal estatus values (used by the Drizzle enum + validation). */
export const DOCUMENT_ESTATUS: readonly DocumentEstatus[] = [
  'pending',
  'fetched',
  'failed',
  'captcha_blocked',
] as const;

/**
 * State machine for a single document row (task 5.4).
 *
 * - `pending` is the only source state: it may move to any terminal state.
 * - Terminal states (`fetched`/`failed`) may re-enter `pending` only on a retry
 *   that re-attempts download.
 * - `captcha_blocked` is a procedure-level signal, not normally a per-file row;
 *   it is allowed to retry to `pending`.
 */
const TRANSITIONS: Record<DocumentEstatus, readonly DocumentEstatus[]> = {
  pending: ['fetched', 'failed', 'captcha_blocked'],
  fetched: ['pending', 'fetched'],
  // Terminal-failure states may ONLY retry (→ pending); they cannot jump to a
  // success state without a fresh attempt.
  failed: ['pending'],
  captcha_blocked: ['pending'],
};

/** True when `from → to` is a legal estatus transition. */
export function isValidTransition(from: DocumentEstatus, to: DocumentEstatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export interface DocumentRecord {
  id: number;
  procedureId: number;
  titulo: string | null;
  tipo: string | null;
  urlFuente: string | null;
  archivoLocal: string | null;
  storageRef: string | null;
  fechaDescarga: Date | null;
  estatus: DocumentEstatus;
  error: string | null;
}

/** Input shape for inserting/upserting a document cache row (DF-4). */
export interface UpsertDocumentInput {
  procedureId: number;
  titulo: string | null;
  tipo: string | null;
  urlFuente: string | null;
  archivoLocal: string | null;
  storageRef: string | null;
  fechaDescarga?: Date | null;
  estatus: DocumentEstatus;
  error?: string | null;
}

export interface DocumentRepository {
  /** Cached documents for a procedure, newest first (DF-1). */
  getByProcedure(procedureId: number): Promise<DocumentRecord[]>;

  /**
   * True when at least one cached `fetched`/`failed`/`captcha_blocked` row
   * exists for the procedure (i.e. a fetch has already been attempted → serve
   * cache instead of re-launching Playwright).
   */
  hasCached(procedureId: number): Promise<boolean>;

  /** Insert a single document row, returning the stored record. */
  upsert(doc: UpsertDocumentInput): Promise<DocumentRecord>;

  /** Bulk-insert document rows (one tx), returning stored records in order. */
  upsertMany(docs: UpsertDocumentInput[]): Promise<DocumentRecord[]>;

  /**
   * Delete every document row for a procedure. Called before a fresh fetch so
   * stale `failed`/`captcha_blocked` markers are replaced atomically.
   */
  deleteForProcedure(procedureId: number): Promise<void>;
}
