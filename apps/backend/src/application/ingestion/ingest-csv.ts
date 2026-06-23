import { streamCsv } from '../../infrastructure/csv/csv-parser.js';
import { mapRow, RowMapError } from './row-mapper.js';
import { QuarantineSink } from './quarantine.js';
import type { MappedRow, MappedSupplier, MappedAmount } from './types.js';
import {
  upsertInstitutions,
  upsertPurchasingUnits,
  upsertSuppliers,
  upsertProcedures,
  fetchInstitutionIdsByClave,
  fetchPurchasingUnitIdsByClave,
  fetchSupplierIdsByRfc,
  fetchProcedureIdsByNumero,
  deleteChildrenForProcedures,
  insertExpedientes,
  insertContracts,
  insertContractAmounts,
  type Db,
} from '../../infrastructure/db/repositories/upsert-repositories.js';

/**
 * Ingestion use case — stream → map → dedupe → idempotent upsert (CI-1..CI-9).
 *
 * ARCHITECTURE
 *   1. Stream-parse the CSV (latin-1, never full-loaded) and map each row.
 *      Malformed rows are quarantined (CI-7); the batch continues.
 *   2. Deduplicate parent entities by natural key in memory (bounded by entity
 *      cardinality, NOT row count) and group each procedure's children.
 *   3. In a single transaction: bulk upsert parents in FK order, resolve natural
 *      keys → ids, then delete + re-insert each procedure's children for
 *      idempotency (CI-8).
 *
 * NOTE on streaming vs. accumulation (CI-2): the raw 60 MB CSV is never slurped;
 * only the deduplicated entity objects (~tens of thousands) are held in memory.
 */

export interface IngestOptions {
  /** Path to the latin-1 CSV file. */
  csvPath: string;
  /** Path to write the JSONL quarantine log. */
  quarantinePath: string;
  /** Optional batch id; defaults to a UTC timestamp. */
  batchId?: string;
  /** Optional progress callback (every `progressEvery` rows) — CI-9. */
  onProgress?: (processed: number, quarantined: number) => void;
  progressEvery?: number;
}

export interface IngestSummary {
  batchId: string;
  rowsRead: number;
  rowsMapped: number;
  quarantined: number;
  /** Distinct entity counts actually written. */
  entities: {
    institutions: number;
    purchasingUnits: number;
    suppliers: number;
    procedures: number;
    expedientes: number;
    contracts: number;
    contractAmounts: number;
  };
  /** Quarantine reason → count, for quick triage. */
  reasons: Record<string, number>;
}

/** Per-procedure accumulator built during the streaming pass. */
interface ProcedureBucket {
  procedure: MappedRow['procedure'];
  /** Expedientes deduped per procedure by codigo_expediente (avoid duplicates). */
  expedientes: Map<string, MappedRow['expediente']>;
  /** Each CSV row becomes one contract (with its optional amount rows). */
  contracts: Array<{ contract: MappedRow['contract']; amounts: MappedRow['amounts'] }>;
}

export async function ingestCsv(db: Db, opts: IngestOptions): Promise<IngestSummary> {
  const batchId = opts.batchId ?? new Date().toISOString();
  const quarantine = new QuarantineSink(opts.quarantinePath);
  const progressEvery = opts.progressEvery ?? 5000;

  // --- Streaming + dedup pass ---
  const institutionsMap = new Map<string, MappedRow['institution']>();
  const purchasingUnitsMap = new Map<string, MappedRow['purchasingUnit']>();
  const suppliersMap = new Map<string, MappedSupplier>();
  const proceduresMap = new Map<string, ProcedureBucket>();

  let rowsRead = 0;
  let rowsMapped = 0;

  const { totalDataRows } = await streamCsv(opts.csvPath, {
    onRow: (rawRow, rowNumber) => {
      rowsRead++;
      if (opts.onProgress && rowsRead % progressEvery === 0) {
        opts.onProgress(rowsRead, quarantine.count);
      }
      let mapped: MappedRow;
      try {
        mapped = mapRow(rawRow);
      } catch (err) {
        const reason =
          err instanceof RowMapError
            ? err.message
            : err instanceof Error
              ? `mapping error: ${err.message}`
              : 'unknown mapping error';
        quarantine.add({ rowNumber, reason, field: err instanceof RowMapError ? err.field : undefined, rawRow });
        return;
      }
      rowsMapped++;

      // Dedupe parents by natural key (last-write-wins for non-key fields).
      institutionsMap.set(mapped.institution.claveInstitucion, mapped.institution);
      purchasingUnitsMap.set(mapped.purchasingUnit.claveUc, mapped.purchasingUnit);
      if (mapped.supplier) suppliersMap.set(mapped.supplier.rfc, mapped.supplier);

      // Group children under their procedure.
      const numero = mapped.procedure.numeroProcedimiento;
      let bucket = proceduresMap.get(numero);
      if (!bucket) {
        bucket = {
          procedure: mapped.procedure,
          expedientes: new Map(),
          contracts: [],
        };
        proceduresMap.set(numero, bucket);
      }
      // Dedupe expedientes within the procedure by codigo_expediente.
      const expKey = mapped.expediente.codigoExpediente ?? `__nocode__${rowNumber}`;
      bucket.expedientes.set(expKey, mapped.expediente);
      bucket.contracts.push({ contract: mapped.contract, amounts: mapped.amounts });
    },
  });

  // --- DB write pass (single transaction) ---
  const summary = await db.transaction(async (tx) => {
    // Parents — upsert in FK order, then resolve ids.
    await upsertInstitutions(tx, [...institutionsMap.values()]);

    const institutionIdByClave = await fetchInstitutionIdsByClave(
      tx,
      [...institutionsMap.keys()],
    );

    const puRows = [...purchasingUnitsMap.values()].map((pu) => ({
      claveUc: pu.claveUc,
      nombreUc: pu.nombreUc,
      institutionId: institutionIdByClave.get(pu.claveInstitucion)!,
    }));
    await upsertPurchasingUnits(tx, puRows);

    const purchasingUnitIdByClave = await fetchPurchasingUnitIdsByClave(
      tx,
      [...purchasingUnitsMap.keys()],
    );

    await upsertSuppliers(tx, [...suppliersMap.values()]);
    const supplierIdByRfc = await fetchSupplierIdsByRfc(tx, [...suppliersMap.keys()]);

    const procRows = [...proceduresMap.values()].map((b) => ({
      ...b.procedure,
      purchasingUnitId: purchasingUnitIdByClave.get(b.procedure.claveUc)!,
      ingestionBatchId: batchId,
    }));
    // `claveUc` is a natural-key ref, not a column — drop it before upsert.
    await upsertProcedures(tx, stripKey(procRows, 'claveUc'));

    const procedureIdByNumero = await fetchProcedureIdsByNumero(
      tx,
      [...proceduresMap.keys()],
    );

    // Children — bulk delete + bulk re-insert (idempotent).
    const allProcedureIds = [...procedureIdByNumero.values()];
    await deleteChildrenForProcedures(tx, allProcedureIds);

    // Build flat insert arrays in deterministic order.
    const expedienteInserts: Array<MappedRow['expediente'] & { procedureId: number }> = [];
    const contractInserts: Array<
      Omit<MappedRow['contract'], 'rfc'> & { procedureId: number; supplierId: number | null }
    > = [];
    // Amounts carry a `contractIx` resolved positionally after contracts insert.
    const amountInserts: Array<{ contractIx: number; row: MappedAmount }> = [];

    for (const [numero, bucket] of proceduresMap) {
      const procedureId = procedureIdByNumero.get(numero)!;
      for (const exp of bucket.expedientes.values()) {
        expedienteInserts.push({ ...exp, procedureId });
      }
      for (const { contract, amounts } of bucket.contracts) {
        const contractIx = contractInserts.length;
        const supplierId = contract.rfc ? (supplierIdByRfc.get(contract.rfc) ?? null) : null;
        const { rfc: _rfc, ...contractWithoutRfc } = contract;
        void _rfc;
        contractInserts.push({ ...contractWithoutRfc, procedureId, supplierId });
        if (amounts.original) amountInserts.push({ contractIx, row: amounts.original });
        if (amounts.convenio) amountInserts.push({ contractIx, row: amounts.convenio });
      }
    }

    await insertExpedientes(tx, expedienteInserts);
    const contractIds = await insertContracts(tx, contractInserts);

    const amountRows = amountInserts.map(({ contractIx, row }) => ({
      ...row,
      contractId: contractIds[contractIx]!,
    }));
    await insertContractAmounts(tx, amountRows);

    return {
      institutions: institutionsMap.size,
      purchasingUnits: purchasingUnitsMap.size,
      suppliers: suppliersMap.size,
      procedures: proceduresMap.size,
      expedientes: expedienteInserts.length,
      contracts: contractInserts.length,
      contractAmounts: amountRows.length,
    };
  });

  await quarantine.flush();

  // Aggregate quarantine reasons for triage.
  const reasons: Record<string, number> = {};
  for (const e of quarantine.snapshot()) reasons[e.reason] = (reasons[e.reason] ?? 0) + 1;

  return {
    batchId,
    rowsRead,
    rowsMapped,
    quarantined: quarantine.count,
    entities: summary,
    reasons,
    totalDataRows,
  } as IngestSummary & { totalDataRows: number };
}

/** Return a shallow copy of each row with `key` removed (for dropping the claveUc ref). */
function stripKey<T, K extends keyof T>(rows: T[], key: K): Omit<T, K>[] {
  return rows.map((r) => {
    const { [key]: _drop, ...rest } = r;
    void _drop;
    return rest;
  });
}
