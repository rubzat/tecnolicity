import { describe, it, expect, vi } from 'vitest';
import { FetchDocuments } from './fetch-documents.js';
import type { QueueInterface } from '../../domain/queue/queue-interface.js';
import type { DocFetcher, FetchOutcome } from '../../domain/documents/doc-fetcher.js';
import type {
  DocumentRepository,
  DocumentRecord,
  ProcedureFetchInfo,
  UpsertDocumentInput,
} from '../../domain/repositories/document-repository.js';

// --- Fakes ------------------------------------------------------------------

let nextId = 1;

class FakeDocumentRepository implements DocumentRepository {
  records = new Map<number, DocumentRecord[]>();
  info = new Map<string, ProcedureFetchInfo>();
  deletions: number[] = [];

  async getByProcedure(id: number): Promise<DocumentRecord[]> {
    return this.records.get(id) ?? [];
  }
  async hasCached(id: number): Promise<boolean> {
    return (this.records.get(id)?.length ?? 0) > 0;
  }
  async upsert(doc: UpsertDocumentInput): Promise<DocumentRecord> {
    const rec: DocumentRecord = {
      id: nextId++,
      procedureId: doc.procedureId,
      titulo: doc.titulo,
      tipo: doc.tipo,
      urlFuente: doc.urlFuente,
      archivoLocal: doc.archivoLocal,
      storageRef: doc.storageRef,
      fechaDescarga: doc.fechaDescarga ?? new Date(),
      estatus: doc.estatus,
      error: doc.error ?? null,
    };
    const list = this.records.get(doc.procedureId) ?? [];
    list.push(rec);
    this.records.set(doc.procedureId, list);
    return rec;
  }
  async upsertMany(docs: UpsertDocumentInput[]): Promise<DocumentRecord[]> {
    const out: DocumentRecord[] = [];
    for (const d of docs) out.push(await this.upsert(d));
    return out;
  }
  async deleteForProcedure(id: number): Promise<void> {
    this.deletions.push(id);
    this.records.delete(id);
  }
  async getProcedureFetchInfo(numero: string): Promise<ProcedureFetchInfo | null> {
    return this.info.get(numero) ?? null;
  }
}

class FakeDocFetcher implements DocFetcher {
  outcome: FetchOutcome = { status: 'no_anexos', documents: [], mode: 'headless' };
  calls = 0;
  delayMs = 0;
  lastUrl: string | null = null;

  async fetch(req: { procedureId: number; url: string }): Promise<FetchOutcome> {
    this.calls += 1;
    this.lastUrl = req.url;
    if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
    return this.outcome;
  }
}

class FakeQueue implements QueueInterface {
  runs = 0;
  async run<T>(task: () => Promise<T>): Promise<T> {
    this.runs += 1;
    return task();
  }
  get activeCount() {
    return 0;
  }
  get pendingCount() {
    return 0;
  }
}

function makeDeps(overrides: Partial<{ enabled: boolean; timeoutMs: number }> = {}) {
  const documents = new FakeDocumentRepository();
  const fetcher = new FakeDocFetcher();
  const queue = new FakeQueue();
  documents.info.set('IA-001', {
    id: 10,
    numeroProcedimiento: 'IA-001',
    direccionAnuncio: 'https://comprasmx.test/#/detalle/UUID/procedimiento',
  });
  const usecase = new FetchDocuments({
    documents,
    fetcher,
    queue,
    enabled: overrides.enabled ?? true,
    timeoutMs: overrides.timeoutMs ?? 5000,
  });
  return { usecase, documents, fetcher, queue };
}

// --- Tests ------------------------------------------------------------------

describe('FetchDocuments use case', () => {
  it('returns null when the procedure is unknown (route → 404)', async () => {
    const { usecase } = makeDeps();
    const result = await usecase.execute('NO-EXISTE');
    expect(result).toBeNull();
  });

  it('returns "disabled" when the feature flag is off', async () => {
    const { usecase, fetcher } = makeDeps({ enabled: false });
    const result = await usecase.execute('IA-001');
    expect(result?.status).toBe('disabled');
    expect(fetcher.calls).toBe(0);
  });

  it('returns "no_anuncio_url" when the procedure has no direccion_anuncio', async () => {
    const { usecase, documents, fetcher } = makeDeps();
    documents.info.set('IA-002', { id: 20, numeroProcedimiento: 'IA-002', direccionAnuncio: null });
    const result = await usecase.execute('IA-002');
    expect(result?.status).toBe('no_anuncio_url');
    expect(fetcher.calls).toBe(0);
  });

  it('cache HIT: returns cached documents WITHOUT launching Playwright (DF-1)', async () => {
    const { usecase, documents, fetcher } = makeDeps();
    // Seed a successful cache.
    documents.records.set(10, [
      {
        id: 1,
        procedureId: 10,
        titulo: 'Bases.pdf',
        tipo: 'PDF',
        urlFuente: 'https://x.test/b.pdf',
        archivoLocal: 'Bases.pdf',
        storageRef: 'documents/10/Bases.pdf',
        fechaDescarga: new Date(),
        estatus: 'fetched',
        error: null,
      },
    ]);
    const result = await usecase.execute('IA-001');
    expect(result?.status).toBe('cached');
    expect(result?.documents).toHaveLength(1);
    expect(fetcher.calls).toBe(0); // Playwright NOT launched
  });

  it('cache MISS: launches the worker, persists results, returns "fetched"', async () => {
    const { usecase, fetcher, documents, queue } = makeDeps();
    fetcher.outcome = {
      status: 'fetched',
      documents: [
        { titulo: 'Bases', tipo: 'PDF', urlFuente: 'https://x.test/1', archivoLocal: 'Bases.pdf', storageRef: 'documents/10/Bases.pdf', estatus: 'fetched' },
        { titulo: 'Anexo A', tipo: 'DOCX', urlFuente: 'https://x.test/2', archivoLocal: null, storageRef: null, estatus: 'failed', error: 'HTTP 403' },
      ],
      mode: 'headless',
    };

    const result = await usecase.execute('IA-001');

    expect(result?.status).toBe('fetched');
    expect(result?.documents).toHaveLength(2);
    expect(fetcher.calls).toBe(1);
    expect(queue.runs).toBe(1); // ran through the isolation queue
    expect(fetcher.lastUrl).toBe('https://comprasmx.test/#/detalle/UUID/procedimiento');
    // Old rows deleted before insert.
    expect(documents.deletions).toContain(10);
    // Both rows persisted (partial: 1 fetched + 1 failed, DF-8).
    const stored = documents.records.get(10)!;
    expect(stored.map((d) => d.estatus).sort()).toEqual(['failed', 'fetched']);
  });

  it('reCAPTCHA blocked: persists a marker row + returns "captcha_blocked" (DF-6, graceful)', async () => {
    const { usecase, fetcher, documents } = makeDeps();
    fetcher.outcome = {
      status: 'captcha_blocked',
      documents: [],
      error: '403 Forbidden',
      mode: 'headless',
    };

    const result = await usecase.execute('IA-001');

    expect(result?.status).toBe('captcha_blocked');
    const stored = documents.records.get(10)!;
    expect(stored).toHaveLength(1);
    expect(stored[0]!.estatus).toBe('captcha_blocked');
    expect(stored[0]!.error).toBe('403 Forbidden');
  });

  it('captcha_blocked does NOT count as a cache hit → retry re-fetches (DF-6 allow retry)', async () => {
    const { usecase, fetcher, documents } = makeDeps();
    // Seed a captcha marker.
    documents.records.set(10, [
      { id: 1, procedureId: 10, titulo: null, tipo: null, urlFuente: null, archivoLocal: null, storageRef: null, fechaDescarga: new Date(), estatus: 'captcha_blocked', error: 'prev' },
    ]);
    // This retry succeeds.
    fetcher.outcome = {
      status: 'fetched',
      documents: [{ titulo: 'Now.pdf', tipo: 'PDF', urlFuente: 'https://x.test/n', archivoLocal: 'Now.pdf', storageRef: 'documents/10/Now.pdf', estatus: 'fetched' }],
      mode: 'non-headless',
    };

    const result = await usecase.execute('IA-001');

    expect(result?.status).toBe('fetched'); // re-attempted, not cached
    expect(fetcher.calls).toBe(1);
  });

  it('"failed" page-load outcome persists a marker and returns "failed"', async () => {
    const { usecase, fetcher } = makeDeps();
    fetcher.outcome = { status: 'failed', documents: [], error: 'navigation timeout', mode: 'headless' };
    const result = await usecase.execute('IA-001');
    expect(result?.status).toBe('failed');
    expect(result?.message).toBeUndefined();
  });

  it('"no_anexos" persists nothing and returns "no_anexos"', async () => {
    const { usecase, fetcher, documents } = makeDeps();
    fetcher.outcome = { status: 'no_anexos', documents: [], mode: 'headless' };
    const result = await usecase.execute('IA-001');
    expect(result?.status).toBe('no_anexos');
    expect(documents.records.get(10)).toBeUndefined();
  });

  it('timeout: returns "timeout" when the worker exceeds the budget', async () => {
    const { usecase, fetcher } = makeDeps({ timeoutMs: 50 });
    fetcher.delayMs = 200; // longer than the 50ms budget
    fetcher.outcome = { status: 'fetched', documents: [], mode: 'headless' };

    const result = await usecase.execute('IA-001');

    expect(result?.status).toBe('timeout');
    expect(result?.message).toMatch(/tiempo máximo/);
  });

  it('passes the fetch through the QueueInterface (worker isolation, DF-7)', async () => {
    const { usecase, queue } = makeDeps();
    await usecase.execute('IA-001');
    expect(queue.runs).toBe(1);
  });

  it('replaces stale rows on re-fetch (delete-then-insert, no duplicates)', async () => {
    const { usecase, fetcher, documents } = makeDeps();
    documents.records.set(10, [
      { id: 1, procedureId: 10, titulo: 'old', tipo: null, urlFuente: 'u', archivoLocal: null, storageRef: null, fechaDescarga: new Date(), estatus: 'failed', error: 'stale' },
    ]);
    fetcher.outcome = {
      status: 'fetched',
      documents: [{ titulo: 'new.pdf', tipo: 'PDF', urlFuente: 'https://x.test/n', archivoLocal: 'new.pdf', storageRef: 'documents/10/new.pdf', estatus: 'fetched' }],
      mode: 'headless',
    };
    await usecase.execute('IA-001');
    const stored = documents.records.get(10)!;
    expect(stored).toHaveLength(1);
    expect(stored[0]!.titulo).toBe('new.pdf');
  });
});
