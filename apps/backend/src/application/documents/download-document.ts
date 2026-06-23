import type { StorageInterface } from '../../domain/storage/storage-interface.js';
import type { DocumentRepository } from '../../domain/repositories/document-repository.js';

/**
 * Use case: resolve a single cached document's local file for download.
 *
 * Security: the document is looked up WITHIN the procedure's own cache rows, so
 * a caller cannot fetch an arbitrary document by guessing ids — the
 * `numeroProcedimiento` must own it. Returns null when the procedure/document is
 * unknown, the row has no downloaded file, or the file is missing on disk.
 */
export interface DownloadInfo {
  absolutePath: string;
  filename: string;
}

export class DownloadDocument {
  constructor(
    private readonly repo: DocumentRepository,
    private readonly storage: StorageInterface,
  ) {}

  async execute(
    numeroProcedimiento: string,
    documentId: number,
  ): Promise<DownloadInfo | null> {
    const proc = await this.repo.getProcedureFetchInfo(numeroProcedimiento);
    if (!proc) return null;

    const docs = await this.repo.getByProcedure(proc.id);
    const doc = docs.find((d) => d.id === documentId);
    if (!doc || !doc.storageRef) return null;

    const exists = await this.storage.exists(doc.storageRef);
    if (!exists) return null;

    return {
      absolutePath: this.storage.getPath(doc.storageRef),
      filename: doc.archivoLocal ?? doc.titulo ?? `documento-${doc.id}`,
    };
  }
}
