import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../../db/schema/index.js';
import { documents } from '../../../db/schema/index.js';
import type {
  DocumentRepository,
  DocumentRecord,
  UpsertDocumentInput,
} from '../../../domain/repositories/document-repository.js';

type Db = NodePgDatabase<typeof schema>;

/** Map a Drizzle row to the domain record shape (camelCase domain port). */
function toRecord(row: typeof documents.$inferSelect): DocumentRecord {
  return {
    id: row.id,
    procedureId: row.procedureId,
    titulo: row.titulo,
    tipo: row.tipo,
    urlFuente: row.urlFuente,
    archivoLocal: row.archivoLocal,
    storageRef: row.storageRef,
    fechaDescarga: row.fechaDescarga,
    estatus: row.estatus,
    error: row.error,
  };
}

/**
 * Drizzle implementation of {@link DocumentRepository}.
 *
 * Cache semantics (DF-1, DF-4): a fetch deletes the procedure's old rows then
 * bulk-inserts fresh ones, so `documents` always reflects the latest attempt
 * (no stale `failed` markers linger after a successful re-fetch).
 */
export class DrizzleDocumentRepository implements DocumentRepository {
  constructor(private readonly db: Db) {}

  async getByProcedure(procedureId: number): Promise<DocumentRecord[]> {
    const rows = await this.db
      .select()
      .from(documents)
      .where(eq(documents.procedureId, procedureId));
    // Newest first (stable: id is serial).
    return rows.map(toRecord).sort((a, b) => b.id - a.id);
  }

  async hasCached(procedureId: number): Promise<boolean> {
    const rows = await this.db
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.procedureId, procedureId))
      .limit(1);
    return rows.length > 0;
  }

  async upsert(doc: UpsertDocumentInput): Promise<DocumentRecord> {
    const [row] = await this.db
      .insert(documents)
      .values({
        procedureId: doc.procedureId,
        titulo: doc.titulo,
        tipo: doc.tipo,
        urlFuente: doc.urlFuente,
        archivoLocal: doc.archivoLocal,
        storageRef: doc.storageRef,
        fechaDescarga: doc.fechaDescarga ?? new Date(),
        estatus: doc.estatus,
        error: doc.error ?? null,
      })
      .returning();
    if (!row) throw new Error('document upsert returned no row');
    return toRecord(row);
  }

  async upsertMany(docs: UpsertDocumentInput[]): Promise<DocumentRecord[]> {
    if (docs.length === 0) return [];
    const rows = await this.db
      .insert(documents)
      .values(
        docs.map((d) => ({
          procedureId: d.procedureId,
          titulo: d.titulo,
          tipo: d.tipo,
          urlFuente: d.urlFuente,
          archivoLocal: d.archivoLocal,
          storageRef: d.storageRef,
          fechaDescarga: d.fechaDescarga ?? new Date(),
          estatus: d.estatus,
          error: d.error ?? null,
        })),
      )
      .returning();
    return rows.map(toRecord);
  }

  async deleteForProcedure(procedureId: number): Promise<void> {
    await this.db.delete(documents).where(eq(documents.procedureId, procedureId));
  }
}
