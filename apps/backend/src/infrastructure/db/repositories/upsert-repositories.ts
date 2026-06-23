import { sql, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  institutions,
  purchasingUnits,
  suppliers,
  procedures,
  expedientes,
  contracts,
  contractAmounts,
} from '../../../db/schema/index.js';
import type {
  MappedInstitution,
  MappedPurchasingUnit,
  MappedSupplier,
  MappedProcedure,
  MappedExpediente,
  MappedContract,
  MappedAmount,
} from '../../../application/ingestion/types.js';

/**
 * Upsert repositories — natural-key deduplication for idempotent ingestion
 * (CI-5, CI-6, CI-8).
 *
 * PARENT entities (institutions, purchasing_units, suppliers, procedures) have
 * UNIQUE indexes on their natural keys → ON CONFLICT DO UPDATE.
 *
 * CHILD entities (expedientes, contracts, contract_amounts) have no natural key
 * in the schema (a procedure legitimately has many unmatchable contracts). For
 * idempotency we BULK-DELETE the child rows for every procedure in the batch
 * then BULK-REINSERT, so re-ingestion replaces rather than duplicates (CI-8).
 *
 * The `contracts → contract_amounts` FK is resolved by RETURNING contract ids in
 * INSERT order: we build the amount rows in the same order as their parent
 * contracts, then map each amount's `contractIx` to the returned id.
 */

/** Drizzle client type alias (avoids importing the singleton + env side-effects). */
export type Db = NodePgDatabase<Record<string, never>>;

// ---------------------------------------------------------------------------
// PARENT UPSERTS (natural-key ON CONFLICT DO UPDATE)
// ---------------------------------------------------------------------------

export async function upsertInstitutions(db: Db, rows: MappedInstitution[]): Promise<void> {
  if (rows.length === 0) return;
  await db
    .insert(institutions)
    .values(rows)
    .onConflictDoUpdate({
      target: institutions.claveInstitucion,
      set: {
        nombreInstitucion: sql`excluded.nombre_institucion`,
        siglas: sql`excluded.siglas`,
        ordenGobierno: sql`excluded.orden_gobierno`,
        claveRamo: sql`excluded.clave_ramo`,
        descripcionRamo: sql`excluded.descripcion_ramo`,
        tipoInstitucion: sql`excluded.tipo_institucion`,
      },
    });
}

export async function upsertPurchasingUnits(
  db: Db,
  rows: Array<Omit<MappedPurchasingUnit, 'claveInstitucion'> & { institutionId: number }>,
): Promise<void> {
  if (rows.length === 0) return;
  await db
    .insert(purchasingUnits)
    .values(rows)
    .onConflictDoUpdate({
      target: purchasingUnits.claveUc,
      set: {
        nombreUc: sql`excluded.nombre_uc`,
        institutionId: sql`excluded.institution_id`,
      },
    });
}

export async function upsertSuppliers(db: Db, rows: MappedSupplier[]): Promise<void> {
  if (rows.length === 0) return;
  await db
    .insert(suppliers)
    .values(rows)
    .onConflictDoUpdate({
      target: suppliers.rfc,
      set: {
        nombre: sql`excluded.nombre`,
        folioRupc: sql`excluded.folio_rupc`,
        pais: sql`excluded.pais`,
        nacionalidad: sql`excluded.nacionalidad`,
        estratificacion: sql`excluded.estratificacion`,
        autoRegistroCompranet: sql`excluded.auto_registro_compranet`,
      },
    });
}

export async function upsertProcedures(
  db: Db,
  rows: Array<Omit<MappedProcedure, 'claveUc'> & { purchasingUnitId: number; ingestionBatchId: string }>,
): Promise<void> {
  if (rows.length === 0) return;
  await db
    .insert(procedures)
    .values(rows)
    .onConflictDoUpdate({
      target: procedures.numeroProcedimiento,
      set: {
        caracter: sql`excluded.caracter`,
        tipoContratacion: sql`excluded.tipo_contratacion`,
        tipoProcedimiento: sql`excluded.tipo_procedimiento`,
        ley: sql`excluded.ley`,
        articuloExcepcion: sql`excluded.articulo_excepcion`,
        descripcionExcepcion: sql`excluded.descripcion_excepcion`,
        contratoMarco: sql`excluded.contrato_marco`,
        compraConsolidada: sql`excluded.compra_consolidada`,
        formaParticipacion: sql`excluded.forma_participacion`,
        casoFortuito: sql`excluded.caso_fortuito`,
        creditoExterno: sql`excluded.credito_externo`,
        estatus: sql`excluded.estatus`,
        fechaPublicacion: sql`excluded.fecha_publicacion`,
        fechaApertura: sql`excluded.fecha_apertura`,
        fechaFallo: sql`excluded.fecha_fallo`,
        direccionAnuncio: sql`excluded.direccion_anuncio`,
        descripcion: sql`excluded.descripcion`,
        purchasingUnitId: sql`excluded.purchasing_unit_id`,
        ingestionBatchId: sql`excluded.ingestion_batch_id`,
      },
    });
}

// ---------------------------------------------------------------------------
// ID RESOLUTION (after parent upserts, before child inserts)
// ---------------------------------------------------------------------------

export async function fetchInstitutionIdsByClave(
  db: Db,
  claves: string[],
): Promise<Map<string, number>> {
  if (claves.length === 0) return new Map();
  const r = await db
    .select({ id: institutions.id, clave: institutions.claveInstitucion })
    .from(institutions)
    .where(inArray(institutions.claveInstitucion, claves));
  return new Map(r.map((x) => [x.clave, x.id]));
}

export async function fetchPurchasingUnitIdsByClave(
  db: Db,
  claves: string[],
): Promise<Map<string, number>> {
  if (claves.length === 0) return new Map();
  const r = await db
    .select({ id: purchasingUnits.id, clave: purchasingUnits.claveUc })
    .from(purchasingUnits)
    .where(inArray(purchasingUnits.claveUc, claves));
  return new Map(r.map((x) => [x.clave, x.id]));
}

export async function fetchSupplierIdsByRfc(
  db: Db,
  rfcs: string[],
): Promise<Map<string, number>> {
  if (rfcs.length === 0) return new Map();
  const r = await db
    .select({ id: suppliers.id, rfc: suppliers.rfc })
    .from(suppliers)
    .where(inArray(suppliers.rfc, rfcs));
  return new Map(r.map((x) => [x.rfc, x.id]));
}

export async function fetchProcedureIdsByNumero(
  db: Db,
  numeros: string[],
): Promise<Map<string, number>> {
  if (numeros.length === 0) return new Map();
  const r = await db
    .select({ id: procedures.id, numero: procedures.numeroProcedimiento })
    .from(procedures)
    .where(inArray(procedures.numeroProcedimiento, numeros));
  return new Map(r.map((x) => [x.numero, x.id]));
}

// ---------------------------------------------------------------------------
// CHILD REPLACE (bulk delete + bulk insert, idempotent — CI-8)
// ---------------------------------------------------------------------------

/**
 * Delete the child rows (expedientes + contracts→amounts via cascade) for every
 * procedure in `procedureIds`, in preparation for an idempotent re-insert.
 */
export async function deleteChildrenForProcedures(
  db: Db,
  procedureIds: number[],
): Promise<void> {
  if (procedureIds.length === 0) return;
  // Order matters: contracts cascade to contract_amounts (FK onDelete:cascade),
  // but deleting expedientes first is harmless and keeps the intent explicit.
  await db.delete(expedientes).where(inArray(expedientes.procedureId, procedureIds));
  await db.delete(contracts).where(inArray(contracts.procedureId, procedureIds));
}

export async function insertExpedientes(
  db: Db,
  rows: Array<MappedExpediente & { procedureId: number }>,
): Promise<void> {
  if (rows.length === 0) return;
  await db.insert(expedientes).values(rows);
}

/**
 * Insert contracts and RETURN their ids in insertion order. PostgreSQL returns
 * multi-row INSERT...RETURNING rows in VALUES order, so callers may correlate
 * the returned ids positionally with their input rows (and thus with the amount
 * rows built in the same order).
 */
export async function insertContracts(
  db: Db,
  rows: Array<Omit<MappedContract, 'rfc'> & { procedureId: number; supplierId: number | null }>,
): Promise<number[]> {
  if (rows.length === 0) return [];
  const inserted = await db.insert(contracts).values(rows).returning({ id: contracts.id });
  return inserted.map((r) => r.id);
}

export async function insertContractAmounts(
  db: Db,
  rows: Array<Omit<MappedAmount, 'tipo'> & { contractId: number; tipo: 'original' | 'convenio' }>,
): Promise<void> {
  if (rows.length === 0) return;
  await db.insert(contractAmounts).values(rows);
}
