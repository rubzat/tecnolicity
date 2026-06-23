/**
 * StorageInterface — domain port for persisting downloaded document files.
 *
 * Abstraction over the physical storage so the application layer never knows
 * whether files land on the local filesystem (MVP) or an S3-compatible bucket
 * (future). The Playwright document fetcher depends on THIS interface, never on
 * `node:fs` directly (hexagonal dependency rule).
 *
 * `storageRef` is the adapter-relative reference (a local path now, an object
 * key later). Callers store it in `documents.storage_ref` and reuse it to read
 * the file back for the download endpoint.
 */
export interface StoredFile {
  /** Adapter-relative reference persisted in `documents.storage_ref`. */
  storageRef: string;
  /** Absolute path on disk (local adapter only; meaningless for remote). */
  absolutePath: string;
  /** File size in bytes. */
  size: number;
}

export interface StorageInterface {
  /**
   * Persist a downloaded file under the procedure's storage namespace.
   * Implementations MUST create parent directories as needed and overwrite on
   * name collision (a re-fetch deletes old rows first, so collisions are
   * residual).
   */
  save(procedureId: number, filename: string, data: Buffer): Promise<StoredFile>;

  /** Resolve a `storageRef` to an absolute filesystem path (local adapter). */
  getPath(storageRef: string): string;

  /** Whether a file exists at the given reference. */
  exists(storageRef: string): Promise<boolean>;

  /** Read a file back as a Buffer (used by the download endpoint / tests). */
  read(storageRef: string): Promise<Buffer>;

  /** Remove a file. No-op if it does not exist. */
  remove(storageRef: string): Promise<void>;
}
