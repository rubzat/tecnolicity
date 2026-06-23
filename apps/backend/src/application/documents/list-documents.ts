import type {
  DocumentRepository,
  DocumentRecord,
} from '../../domain/repositories/document-repository.js';

/**
 * Use case: list cached documents for a procedure (GET /documents, DF-1 read).
 * Returns `{ found: false }` when the procedure itself is unknown so the route
 * can answer 404; otherwise the cached rows (possibly empty when not yet
 * fetched).
 */
export class ListDocuments {
  constructor(private readonly repo: DocumentRepository) {}

  async execute(numeroProcedimiento: string): Promise<{
    found: boolean;
    documents: DocumentRecord[];
  }> {
    const proc = await this.repo.getProcedureFetchInfo(numeroProcedimiento);
    if (!proc) return { found: false, documents: [] };
    const documents = await this.repo.getByProcedure(proc.id);
    return { found: true, documents };
  }
}
