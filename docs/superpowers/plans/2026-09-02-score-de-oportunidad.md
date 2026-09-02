# Score de Oportunidad — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada vigente muestra un score de oportunidad 0-100 (o "sin datos suficientes"), calculado a partir de monto estimado, nivel de competencia y riesgo de proveedor dominante — precalculado una vez al día por segmento, nunca en vivo.

**Architecture:** Arquitectura hexagonal existente. Un caso de uso agrega `contracts` históricos por (`tipo_contratación`, `siglas_dependencia`), normaliza y guarda una fila por segmento en una tabla de caché nueva. `GET /vigentes` hace un LEFT JOIN barato contra esa caché al leer. Se dispara desde el mismo hook `onScrapeComplete` que ya usa `EvaluateAlerts`.

**Tech Stack:** Express + TypeScript, Drizzle ORM + Postgres (`percentile_cont`/window functions, mismo patrón que `market-repository.ts`), Zod, Vitest, React + TanStack Query.

**Spec:** [docs/superpowers/specs/2026-09-02-score-de-oportunidad-design.md](../specs/2026-09-02-score-de-oportunidad-design.md)

**⚠️ Dependencia de rama:** este plan asume que ya existe el hook `onScrapeComplete` de `startVigenteCron` y el composition root de `EvaluateAlerts` en `presentation/server.ts` — ambos los agregó la feature de alertas (PR13), que todavía no está mergeada a `main`. **Esta rama debe crearse a partir de `worktree-alertas-por-email` (o de `main` una vez que ese PR ya esté mergeado), nunca directo desde el `main` actual.** Todos los file paths y snippets de este plan asumen el estado de esa rama tras el commit `1fbb8e6` (Task 6-9 del plan de alertas ya aplicadas).

## Global Constraints

- Todos los archivos backend nuevos siguen el patrón hexagonal existente: `domain/repositories/*.ts` (interfaces), `infrastructure/db/repositories/*.ts` (Drizzle), `application/*/*.ts` (casos de uso), `presentation/routes/*.ts` (Express).
- Imports cruzados de módulos backend usan extensión `.js` (ESM); los archivos directamente bajo `db/schema/` son la única excepción ya establecida (imports sin extensión, requerido por el cargador CJS de drizzle-kit).
- Ninguna fórmula ni umbral queda escondido dentro de la lógica de agregación — pesos (0.6/0.4), penalización (-30), umbral de dominancia (60%) y tamaño mínimo de muestra (3) son constantes nombradas en el código.
- Cada tarea termina con `pnpm exec tsc --noEmit` limpio en `apps/backend` (o `apps/frontend` para la tarea de frontend) antes de commitear.
- Commits en español, mismo estilo que el resto del repo (`feat(score): ...`).

---

## Task 1: Schema — `opportunity_segment_stats`

**Files:**
- Create: `apps/backend/src/db/schema/opportunity-segment-stats.ts`
- Modify: `apps/backend/src/db/schema/index.ts`
- Create (generado): `apps/backend/drizzle/migrations/000X_<nombre-generado>.sql`

**Interfaces:**
- Produces: tabla `opportunity_segment_stats` (una fila por segmento `tipo_contratación` + `siglas_dependencia`).

- [ ] **Step 1: Crear el schema**

Crear `apps/backend/src/db/schema/opportunity-segment-stats.ts`:

```ts
import { pgTable, serial, text, integer, numeric, boolean, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAt } from './_shared';

/**
 * Caché de estadísticas de mercado por segmento (tipo_contratación +
 * siglas_dependencia), usada para calcular el score de oportunidad de cada
 * vigente sin agregar `contracts` en cada request (PR14). Se recalcula
 * completa una vez al día (ver ComputeOpportunityScores) vía upsert por
 * segmento — nunca truncate-then-insert, así un fallo a mitad de corrida
 * deja los segmentos ya procesados en su valor más reciente.
 *
 * `siglas_dependencia` corresponde a `institutions.clave_institucion` en el
 * dataset histórico y a `vigente_procedures.siglas_dependencia` en los datos
 * en vivo — el schema de `vigente_procedures` ya documenta esta
 * correspondencia ("can be enriched later by joining siglas against the
 * institutions table").
 */
export const opportunitySegmentStats = pgTable(
  'opportunity_segment_stats',
  {
    id: serial('id').primaryKey(),
    tipoContratacion: text('tipo_contratacion').notNull(),
    siglasDependencia: text('siglas_dependencia').notNull(),
    /** # de contratos históricos que respaldan este cálculo. */
    sampleSize: integer('sample_size').notNull(),
    medianAmount: numeric('median_amount', { precision: 18, scale: 2 }),
    /** 0-100, normalizado (min-max) contra todos los segmentos de la misma corrida. */
    amountScore: integer('amount_score').notNull(),
    distinctSuppliers: integer('distinct_suppliers').notNull(),
    /** 0-100, normalizado — menos proveedores = más alto. */
    competitionScore: integer('competition_score').notNull(),
    /** % de participación del proveedor top en el segmento (para el desglose). */
    dominantSupplierShare: numeric('dominant_supplier_share', { precision: 5, scale: 2 }),
    /** true si un proveedor tiene ≥60% del segmento (mismo umbral que /market dominance). */
    isDominated: boolean('is_dominated').notNull(),
    /** Score final 0-100, ya calculado — nunca se recalcula al leer. */
    score: integer('score').notNull(),
    computedAt: createdAt(),
  },
  (table) => [
    uniqueIndex('opportunity_segment_stats_segment_idx').on(table.tipoContratacion, table.siglasDependencia),
  ],
);
```

Nota: `createdAt()` del helper compartido (`defaultNow()`) se reusa como columna `computed_at` — cada `upsertSegment` la vuelve a setear explícitamente a `new Date()` en el `onConflictDoUpdate` (ver Task 2), así que el default solo aplica al primer insert de cada segmento.

- [ ] **Step 2: Exportar la tabla**

Editar `apps/backend/src/db/schema/index.ts`, agregar al final:

```ts
export { opportunitySegmentStats } from './opportunity-segment-stats';
```

- [ ] **Step 3: Generar la migración**

```bash
cd apps/backend && pnpm db:generate
```

Abrir el archivo `.sql` generado y confirmar que contiene **únicamente**
`CREATE TABLE "opportunity_segment_stats" (...)` con su índice único — nada
sobre `users`, `saved_searches`, `saved_search_matches`, `vigente_procedures`
ni ninguna tabla histórica.

- [ ] **Step 4: Aplicar la migración**

```bash
docker compose -f docker-compose.yml up -d
sleep 3
cd apps/backend && pnpm db:migrate
```

Expected: `[migrate] done.` sin errores.

- [ ] **Step 5: Verificar con SQL directo**

```bash
docker exec tecnolicity-postgres psql -U tecnolicity -d tecnolicity -c "\d opportunity_segment_stats"
```

Expected: todas las columnas descritas arriba, con el índice único sobre `(tipo_contratacion, siglas_dependencia)`.

- [ ] **Step 6: Typecheck + suite completa**

```bash
pnpm exec tsc --noEmit && pnpm test
```

Expected: typecheck limpio; todos los tests existentes siguen pasando (todavía no hay tests nuevos).

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/db/schema/opportunity-segment-stats.ts apps/backend/src/db/schema/index.ts apps/backend/drizzle/migrations/
git commit -m "feat(score): agrega schema de opportunity_segment_stats"
```

---

## Task 2: `OpportunityScoreRepository` (dominio + Drizzle)

**Files:**
- Create: `apps/backend/src/domain/repositories/opportunity-score-repository.ts`
- Create: `apps/backend/src/infrastructure/db/repositories/opportunity-score-repository.ts`
- Test: `apps/backend/src/infrastructure/db/repositories/opportunity-score-repository.integration.test.ts`

**Interfaces:**
- Consumes: tabla `opportunity_segment_stats` (Task 1), tablas históricas existentes `contracts`/`procedures`/`purchasing_units`/`institutions`/`suppliers`.
- Produces: `OpportunityScoreRepository`, `RawSegmentAggregate`, `OpportunitySegmentStats`, `DrizzleOpportunityScoreRepository` — usados por Task 4 (`ComputeOpportunityScores`).

- [ ] **Step 1: Escribir la interfaz de dominio**

Crear `apps/backend/src/domain/repositories/opportunity-score-repository.ts`:

```ts
/**
 * OpportunityScoreRepository — dominio port para `opportunity_segment_stats`
 * (PR14). Combina dos responsabilidades relacionadas: leer los datos
 * históricos crudos que alimentan el cálculo (agregación sobre
 * contracts/procedures/institutions/suppliers, igual que hace
 * MarketRepository) y leer/escribir la caché de resultados ya normalizados.
 */

/** Fila cruda por segmento, ANTES de normalizar (0-100) ni aplicar la fórmula final. */
export interface RawSegmentAggregate {
  tipoContratacion: string;
  siglasDependencia: string;
  sampleSize: number;
  medianAmount: number;
  distinctSuppliers: number;
  /** % de participación del proveedor con más monto en el segmento (0-100), null si no hay proveedor con monto. */
  dominantSupplierShare: number | null;
}

/** Fila normalizada y con score final — lo que se guarda en la tabla de caché. */
export interface OpportunitySegmentStats {
  tipoContratacion: string;
  siglasDependencia: string;
  sampleSize: number;
  medianAmount: number;
  amountScore: number;
  distinctSuppliers: number;
  competitionScore: number;
  dominantSupplierShare: number | null;
  isDominated: boolean;
  score: number;
}

export interface OpportunityScoreRepository {
  /**
   * Agrega TODOS los contratos históricos por (tipo_contratación, siglas),
   * sin filtrar por tamaño de muestra (ese filtro lo aplica el caso de uso).
   */
  computeRawSegmentAggregates(): Promise<RawSegmentAggregate[]>;

  /** Upsert de una fila normalizada — nunca trunca la tabla. */
  upsertSegment(stats: OpportunitySegmentStats): Promise<void>;

  /** Lectura directa de un segmento (usada en tests/inspección). */
  findBySegment(tipoContratacion: string, siglasDependencia: string): Promise<OpportunitySegmentStats | null>;
}
```

- [ ] **Step 2: Escribir el test de integración (fallando)**

Crear `apps/backend/src/infrastructure/db/repositories/opportunity-score-repository.integration.test.ts`. Este test siembra sus propias filas deterministas en `institutions`/`purchasing_units`/`suppliers`/`procedures`/`contracts` — el mismo patrón verificado manualmente contra Postgres antes de escribir este plan (3 contratos: montos 100/200/700, dos proveedores, uno con 80% del monto del segmento):

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db, pool } from '../../../db/client.js';
import {
  institutions,
  purchasingUnits,
  suppliers,
  procedures,
  contracts,
} from '../../../db/schema/index.js';
import { DrizzleOpportunityScoreRepository } from './opportunity-score-repository.js';

const repo = new DrizzleOpportunityScoreRepository(db);
const TEST_TIPO = '__TEST_TIPO_ADQUISICIONES__';
const TEST_CLAVE = `__TEST_INST_${Date.now()}__`;

async function cleanup() {
  const rows = await db
    .select({ id: procedures.id })
    .from(procedures)
    .where(eq(procedures.tipoContratacion, TEST_TIPO));
  const procedureIds = rows.map((r) => r.id);
  if (procedureIds.length > 0) {
    await db.delete(contracts).where(inArray(contracts.procedureId, procedureIds));
    await db.delete(procedures).where(inArray(procedures.id, procedureIds));
  }
  await db.delete(purchasingUnits).where(eq(purchasingUnits.claveUc, `${TEST_CLAVE}-UC`));
  await db.delete(institutions).where(eq(institutions.claveInstitucion, TEST_CLAVE));
  await db.delete(suppliers).where(inArray(suppliers.rfc, [`${TEST_CLAVE}-S1`, `${TEST_CLAVE}-S2`]));
}

beforeEach(async () => {
  await cleanup();

  const [inst] = await db
    .insert(institutions)
    .values({ claveInstitucion: TEST_CLAVE, nombreInstitucion: 'Institución de prueba', siglas: 'TEST' })
    .returning();
  const [unit] = await db
    .insert(purchasingUnits)
    .values({ claveUc: `${TEST_CLAVE}-UC`, nombreUc: 'Unidad de prueba', institutionId: inst!.id })
    .returning();
  const [s1] = await db.insert(suppliers).values({ rfc: `${TEST_CLAVE}-S1`, nombre: 'Proveedor 1' }).returning();
  const [s2] = await db.insert(suppliers).values({ rfc: `${TEST_CLAVE}-S2`, nombre: 'Proveedor 2' }).returning();

  const [p1] = await db
    .insert(procedures)
    .values({ numeroProcedimiento: `${TEST_CLAVE}-P1`, tipoContratacion: TEST_TIPO, purchasingUnitId: unit!.id })
    .returning();
  const [p2] = await db
    .insert(procedures)
    .values({ numeroProcedimiento: `${TEST_CLAVE}-P2`, tipoContratacion: TEST_TIPO, purchasingUnitId: unit!.id })
    .returning();
  const [p3] = await db
    .insert(procedures)
    .values({ numeroProcedimiento: `${TEST_CLAVE}-P3`, tipoContratacion: TEST_TIPO, purchasingUnitId: unit!.id })
    .returning();

  await db.insert(contracts).values([
    { procedureId: p1!.id, supplierId: s1!.id, importeDrc: '100.00' },
    { procedureId: p2!.id, supplierId: s2!.id, importeDrc: '200.00' },
    { procedureId: p3!.id, supplierId: s1!.id, importeDrc: '700.00' },
  ]);
});

afterAll(async () => {
  await cleanup();
  await pool.end();
});

describe('DrizzleOpportunityScoreRepository', () => {
  it('computeRawSegmentAggregates calcula mediana, tamaño de muestra, proveedores distintos y dominancia', async () => {
    const rows = await repo.computeRawSegmentAggregates();
    const segment = rows.find((r) => r.tipoContratacion === TEST_TIPO && r.siglasDependencia === TEST_CLAVE);

    expect(segment).toBeDefined();
    expect(segment!.sampleSize).toBe(3);
    expect(segment!.medianAmount).toBe(200); // 100, 200, 700 -> mediana 200
    expect(segment!.distinctSuppliers).toBe(2);
    // Proveedor 1 (S1) tiene 100+700=800 de 1000 totales -> 80%
    expect(segment!.dominantSupplierShare).toBeCloseTo(80, 1);
  });

  it('upsertSegment escribe y findBySegment lee la fila normalizada', async () => {
    await repo.upsertSegment({
      tipoContratacion: TEST_TIPO,
      siglasDependencia: TEST_CLAVE,
      sampleSize: 3,
      medianAmount: 200,
      amountScore: 55,
      distinctSuppliers: 2,
      competitionScore: 60,
      dominantSupplierShare: 80,
      isDominated: true,
      score: 33,
    });

    const found = await repo.findBySegment(TEST_TIPO, TEST_CLAVE);
    expect(found).not.toBeNull();
    expect(found!.score).toBe(33);
    expect(found!.isDominated).toBe(true);
  });

  it('upsertSegment sobre el mismo segmento actualiza en vez de duplicar', async () => {
    await repo.upsertSegment({
      tipoContratacion: TEST_TIPO,
      siglasDependencia: TEST_CLAVE,
      sampleSize: 3,
      medianAmount: 200,
      amountScore: 55,
      distinctSuppliers: 2,
      competitionScore: 60,
      dominantSupplierShare: 80,
      isDominated: true,
      score: 33,
    });
    await repo.upsertSegment({
      tipoContratacion: TEST_TIPO,
      siglasDependencia: TEST_CLAVE,
      sampleSize: 4,
      medianAmount: 250,
      amountScore: 60,
      distinctSuppliers: 3,
      competitionScore: 50,
      dominantSupplierShare: 70,
      isDominated: true,
      score: 56,
    });

    const found = await repo.findBySegment(TEST_TIPO, TEST_CLAVE);
    expect(found!.sampleSize).toBe(4);
    expect(found!.score).toBe(56);
  });

  it('findBySegment devuelve null para un segmento inexistente', async () => {
    expect(await repo.findBySegment('__NO_EXISTE__', '__NO_EXISTE__')).toBeNull();
  });
});
```

- [ ] **Step 3: Verificar que falla**

```bash
cd apps/backend && pnpm exec vitest run src/infrastructure/db/repositories/opportunity-score-repository.integration.test.ts
```

Expected: FAIL — módulo `./opportunity-score-repository.js` no encontrado.

- [ ] **Step 4: Implementar `DrizzleOpportunityScoreRepository`**

Crear `apps/backend/src/infrastructure/db/repositories/opportunity-score-repository.ts`. Las dos consultas de `computeRawSegmentAggregates` (estadísticas de segmento + dominancia) están verificadas manualmente contra Postgres real antes de escribir este plan — mismo patrón de joins y funciones de ventana que `dominance()`/`competitors()` en `market-repository.ts`, solo que agrupado por (`tipo_contratación`, `clave_institución`) en vez de por institución sola:

```ts
import { eq, and, count, countDistinct, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../../db/schema/index.js';
import {
  opportunitySegmentStats,
  contracts,
  procedures,
  purchasingUnits,
  institutions,
} from '../../../db/schema/index.js';
import type {
  OpportunityScoreRepository,
  RawSegmentAggregate,
  OpportunitySegmentStats,
} from '../../../domain/repositories/opportunity-score-repository.js';

type Db = NodePgDatabase<typeof schema>;

function toStats(row: typeof opportunitySegmentStats.$inferSelect): OpportunitySegmentStats {
  return {
    tipoContratacion: row.tipoContratacion,
    siglasDependencia: row.siglasDependencia,
    sampleSize: row.sampleSize,
    medianAmount: row.medianAmount == null ? 0 : Number(row.medianAmount),
    amountScore: row.amountScore,
    distinctSuppliers: row.distinctSuppliers,
    competitionScore: row.competitionScore,
    dominantSupplierShare: row.dominantSupplierShare == null ? null : Number(row.dominantSupplierShare),
    isDominated: row.isDominated,
    score: row.score,
  };
}

export class DrizzleOpportunityScoreRepository implements OpportunityScoreRepository {
  constructor(private readonly db: Db) {}

  async computeRawSegmentAggregates(): Promise<RawSegmentAggregate[]> {
    // Estadísticas de segmento: tamaño de muestra, mediana, # de proveedores distintos.
    const segmentRows = await this.db
      .select({
        tipoContratacion: procedures.tipoContratacion,
        claveInstitucion: institutions.claveInstitucion,
        sampleSize: count(contracts.id),
        medianAmount: sql<string>`percentile_cont(0.5) WITHIN GROUP (ORDER BY ${contracts.importeDrc}::double precision)`,
        distinctSuppliers: countDistinct(contracts.supplierId),
      })
      .from(contracts)
      .innerJoin(procedures, eq(procedures.id, contracts.procedureId))
      .innerJoin(purchasingUnits, eq(purchasingUnits.id, procedures.purchasingUnitId))
      .innerJoin(institutions, eq(institutions.id, purchasingUnits.institutionId))
      .where(sql`${procedures.tipoContratacion} IS NOT NULL`)
      .groupBy(procedures.tipoContratacion, institutions.claveInstitucion);

    // Dominancia: % del proveedor con más monto dentro de cada segmento.
    const ranked = this.db
      .select({
        tipoContratacion: procedures.tipoContratacion,
        claveInstitucion: institutions.claveInstitucion,
        supplierAmount: sql<string>`coalesce(sum(${contracts.importeDrc}), 0)`.as('supplier_amount'),
        segmentTotalAmount: sql<string>`sum(sum(${contracts.importeDrc})) over (partition by ${procedures.tipoContratacion}, ${institutions.claveInstitucion})`.as(
          'segment_total_amount',
        ),
        rn: sql<number>`row_number() over (partition by ${procedures.tipoContratacion}, ${institutions.claveInstitucion} order by sum(${contracts.importeDrc}) desc nulls last)`.as(
          'rn',
        ),
      })
      .from(contracts)
      .innerJoin(procedures, eq(procedures.id, contracts.procedureId))
      .innerJoin(purchasingUnits, eq(purchasingUnits.id, procedures.purchasingUnitId))
      .innerJoin(institutions, eq(institutions.id, purchasingUnits.institutionId))
      .where(and(sql`${procedures.tipoContratacion} IS NOT NULL`, sql`${contracts.supplierId} IS NOT NULL`))
      .groupBy(procedures.tipoContratacion, institutions.claveInstitucion, contracts.supplierId)
      .as('ranked');

    const dominanceRows = await this.db
      .select({
        tipoContratacion: ranked.tipoContratacion,
        claveInstitucion: ranked.claveInstitucion,
        dominantSharePct: sql<string>`round(100.0 * ${ranked.supplierAmount} / nullif(${ranked.segmentTotalAmount}, 0), 2)`,
      })
      .from(ranked)
      .where(eq(ranked.rn, 1));

    const dominanceBySegment = new Map<string, number>();
    for (const d of dominanceRows) {
      dominanceBySegment.set(`${d.tipoContratacion}::${d.claveInstitucion}`, Number(d.dominantSharePct));
    }

    return segmentRows.map((r) => ({
      tipoContratacion: r.tipoContratacion!,
      siglasDependencia: r.claveInstitucion,
      sampleSize: Number(r.sampleSize ?? 0),
      medianAmount: r.medianAmount == null ? 0 : Number(r.medianAmount),
      distinctSuppliers: Number(r.distinctSuppliers ?? 0),
      dominantSupplierShare: dominanceBySegment.get(`${r.tipoContratacion}::${r.claveInstitucion}`) ?? null,
    }));
  }

  async upsertSegment(stats: OpportunitySegmentStats): Promise<void> {
    await this.db
      .insert(opportunitySegmentStats)
      .values({
        tipoContratacion: stats.tipoContratacion,
        siglasDependencia: stats.siglasDependencia,
        sampleSize: stats.sampleSize,
        medianAmount: String(stats.medianAmount),
        amountScore: stats.amountScore,
        distinctSuppliers: stats.distinctSuppliers,
        competitionScore: stats.competitionScore,
        dominantSupplierShare: stats.dominantSupplierShare == null ? null : String(stats.dominantSupplierShare),
        isDominated: stats.isDominated,
        score: stats.score,
        computedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [opportunitySegmentStats.tipoContratacion, opportunitySegmentStats.siglasDependencia],
        set: {
          sampleSize: sql`excluded.sample_size`,
          medianAmount: sql`excluded.median_amount`,
          amountScore: sql`excluded.amount_score`,
          distinctSuppliers: sql`excluded.distinct_suppliers`,
          competitionScore: sql`excluded.competition_score`,
          dominantSupplierShare: sql`excluded.dominant_supplier_share`,
          isDominated: sql`excluded.is_dominated`,
          score: sql`excluded.score`,
          computedAt: sql`excluded.computed_at`,
        },
      });
  }

  async findBySegment(tipoContratacion: string, siglasDependencia: string): Promise<OpportunitySegmentStats | null> {
    const [row] = await this.db
      .select()
      .from(opportunitySegmentStats)
      .where(
        and(
          eq(opportunitySegmentStats.tipoContratacion, tipoContratacion),
          eq(opportunitySegmentStats.siglasDependencia, siglasDependencia),
        ),
      )
      .limit(1);
    return row ? toStats(row) : null;
  }
}
```

- [ ] **Step 5: Correr el test y confirmar que pasa**

```bash
docker compose -f docker-compose.yml up -d && sleep 3 && cd apps/backend && pnpm db:migrate
pnpm exec vitest run src/infrastructure/db/repositories/opportunity-score-repository.integration.test.ts
```

Expected: 4/4 tests PASS. Si `medianAmount`/`dominantSupplierShare` no dan los valores esperados exactos, revisar el cast `::double precision` en la consulta SQL antes de asumir un bug en Drizzle — la consulta ya fue verificada manualmente contra Postgres real con este mismo dataset antes de escribir este plan.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/domain/repositories/opportunity-score-repository.ts apps/backend/src/infrastructure/db/repositories/opportunity-score-repository.ts apps/backend/src/infrastructure/db/repositories/opportunity-score-repository.integration.test.ts
git commit -m "feat(score): agrega OpportunityScoreRepository (dominio + Drizzle)"
```

---

## Task 3: `opportunity-score-calculator.ts` — fórmula pura

**Files:**
- Create: `apps/backend/src/application/opportunities/opportunity-score-calculator.ts`
- Test: `apps/backend/src/application/opportunities/opportunity-score-calculator.test.ts`

**Interfaces:**
- Produces: `computeScore()`, `ScoreInput`, `ScoreResult` — usados por Task 4.

- [ ] **Step 1: Escribir el test (fallando)**

Crear `apps/backend/src/application/opportunities/opportunity-score-calculator.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeScore } from './opportunity-score-calculator.js';

describe('computeScore', () => {
  it('combina amount_score (60%) y competition_score (40%) sin dominancia', () => {
    const { score } = computeScore({ amountScore: 100, competitionScore: 0, isDominated: false });
    expect(score).toBe(60); // 0.6*100 + 0.4*0 = 60
  });

  it('aplica la penalización de -30 cuando hay un proveedor dominante', () => {
    const { score } = computeScore({ amountScore: 100, competitionScore: 100, isDominated: true });
    expect(score).toBe(70); // (0.6*100+0.4*100)=100, -30 = 70
  });

  it('nunca baja de 0 aunque la penalización lo empuje negativo', () => {
    const { score } = computeScore({ amountScore: 10, competitionScore: 0, isDominated: true });
    expect(score).toBe(0); // 0.6*10=6, -30 = -24 -> clamped a 0
  });

  it('nunca sube de 100', () => {
    const { score } = computeScore({ amountScore: 100, competitionScore: 100, isDominated: false });
    expect(score).toBe(100);
  });

  it('redondea al entero más cercano', () => {
    const { score } = computeScore({ amountScore: 33, competitionScore: 67, isDominated: false });
    // 0.6*33 + 0.4*67 = 19.8 + 26.8 = 46.6 -> 47
    expect(score).toBe(47);
  });
});
```

- [ ] **Step 2: Verificar que falla**

```bash
cd apps/backend && pnpm exec vitest run src/application/opportunities/opportunity-score-calculator.test.ts
```

Expected: FAIL — módulo no encontrado.

- [ ] **Step 3: Implementar `computeScore`**

Crear `apps/backend/src/application/opportunities/opportunity-score-calculator.ts`:

```ts
/**
 * Fórmula del score de oportunidad (PR14). Pesos y penalización son
 * constantes nombradas, no mágicas — ver spec para el razonamiento.
 */
const AMOUNT_WEIGHT = 0.6;
const COMPETITION_WEIGHT = 0.4;
const DOMINANCE_PENALTY = 30;

export interface ScoreInput {
  /** 0-100, ya normalizado contra los demás segmentos de la corrida. */
  amountScore: number;
  /** 0-100, ya normalizado (más alto = menos competencia). */
  competitionScore: number;
  isDominated: boolean;
}

export interface ScoreResult {
  score: number;
}

export function computeScore(input: ScoreInput): ScoreResult {
  const raw = AMOUNT_WEIGHT * input.amountScore + COMPETITION_WEIGHT * input.competitionScore;
  const penalized = input.isDominated ? raw - DOMINANCE_PENALTY : raw;
  const score = Math.max(0, Math.min(100, Math.round(penalized)));
  return { score };
}
```

- [ ] **Step 4: Correr el test y confirmar que pasa**

```bash
cd apps/backend && pnpm exec vitest run src/application/opportunities/opportunity-score-calculator.test.ts
```

Expected: 5/5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/application/opportunities/opportunity-score-calculator.ts apps/backend/src/application/opportunities/opportunity-score-calculator.test.ts
git commit -m "feat(score): agrega opportunity-score-calculator (fórmula pura)"
```

---

## Task 4: `ComputeOpportunityScores` — caso de uso de agregación

**Files:**
- Create: `apps/backend/src/application/opportunities/compute-opportunity-scores.ts`
- Test: `apps/backend/src/application/opportunities/compute-opportunity-scores.test.ts`

**Interfaces:**
- Consumes: `OpportunityScoreRepository` (Task 2), `computeScore` (Task 3).
- Produces: `normalizeAndScore()`, `ComputeOpportunityScores`, `ComputeOpportunityScoresSummary` — usado por Task 5 (wiring).

- [ ] **Step 1: Escribir el test (fallando)**

Crear `apps/backend/src/application/opportunities/compute-opportunity-scores.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { normalizeAndScore, ComputeOpportunityScores } from './compute-opportunity-scores.js';
import type {
  OpportunityScoreRepository,
  RawSegmentAggregate,
  OpportunitySegmentStats,
} from '../../domain/repositories/opportunity-score-repository.js';

describe('normalizeAndScore', () => {
  it('descarta segmentos con menos de 3 contratos de muestra', () => {
    const raw: RawSegmentAggregate[] = [
      { tipoContratacion: 'A', siglasDependencia: 'X', sampleSize: 2, medianAmount: 100, distinctSuppliers: 1, dominantSupplierShare: 100 },
      { tipoContratacion: 'B', siglasDependencia: 'Y', sampleSize: 5, medianAmount: 200, distinctSuppliers: 3, dominantSupplierShare: 40 },
    ];
    const result = normalizeAndScore(raw);
    expect(result).toHaveLength(1);
    expect(result[0]!.tipoContratacion).toBe('B');
  });

  it('normaliza amount_score con min-max contra todos los segmentos calificados', () => {
    const raw: RawSegmentAggregate[] = [
      { tipoContratacion: 'A', siglasDependencia: 'X', sampleSize: 3, medianAmount: 0, distinctSuppliers: 5, dominantSupplierShare: 0 },
      { tipoContratacion: 'B', siglasDependencia: 'Y', sampleSize: 3, medianAmount: 1000, distinctSuppliers: 5, dominantSupplierShare: 0 },
    ];
    const result = normalizeAndScore(raw);
    const a = result.find((r) => r.tipoContratacion === 'A')!;
    const b = result.find((r) => r.tipoContratacion === 'B')!;
    expect(a.amountScore).toBe(0);
    expect(b.amountScore).toBe(100);
  });

  it('invierte competition_score: menos proveedores = score más alto', () => {
    const raw: RawSegmentAggregate[] = [
      { tipoContratacion: 'A', siglasDependencia: 'X', sampleSize: 3, medianAmount: 100, distinctSuppliers: 1, dominantSupplierShare: 100 },
      { tipoContratacion: 'B', siglasDependencia: 'Y', sampleSize: 3, medianAmount: 100, distinctSuppliers: 10, dominantSupplierShare: 20 },
    ];
    const result = normalizeAndScore(raw);
    const a = result.find((r) => r.tipoContratacion === 'A')!; // 1 proveedor -> menos competencia
    const b = result.find((r) => r.tipoContratacion === 'B')!; // 10 proveedores -> más competencia
    expect(a.competitionScore).toBe(100);
    expect(b.competitionScore).toBe(0);
  });

  it('usa 50 (neutral) cuando todos los segmentos tienen el mismo valor (sin varianza)', () => {
    const raw: RawSegmentAggregate[] = [
      { tipoContratacion: 'A', siglasDependencia: 'X', sampleSize: 3, medianAmount: 500, distinctSuppliers: 4, dominantSupplierShare: 0 },
      { tipoContratacion: 'B', siglasDependencia: 'Y', sampleSize: 3, medianAmount: 500, distinctSuppliers: 4, dominantSupplierShare: 0 },
    ];
    const result = normalizeAndScore(raw);
    expect(result[0]!.amountScore).toBe(50);
    expect(result[1]!.competitionScore).toBe(50);
  });

  it('marca is_dominated cuando dominant_supplier_share >= 60', () => {
    const raw: RawSegmentAggregate[] = [
      { tipoContratacion: 'A', siglasDependencia: 'X', sampleSize: 3, medianAmount: 100, distinctSuppliers: 2, dominantSupplierShare: 60 },
      { tipoContratacion: 'B', siglasDependencia: 'Y', sampleSize: 3, medianAmount: 100, distinctSuppliers: 2, dominantSupplierShare: 59.9 },
    ];
    const result = normalizeAndScore(raw);
    expect(result.find((r) => r.tipoContratacion === 'A')!.isDominated).toBe(true);
    expect(result.find((r) => r.tipoContratacion === 'B')!.isDominated).toBe(false);
  });

  it('trata dominant_supplier_share null como 0 (no dominado)', () => {
    const raw: RawSegmentAggregate[] = [
      { tipoContratacion: 'A', siglasDependencia: 'X', sampleSize: 3, medianAmount: 100, distinctSuppliers: 2, dominantSupplierShare: null },
      { tipoContratacion: 'B', siglasDependencia: 'Y', sampleSize: 3, medianAmount: 200, distinctSuppliers: 3, dominantSupplierShare: 10 },
    ];
    const result = normalizeAndScore(raw);
    expect(result.find((r) => r.tipoContratacion === 'A')!.isDominated).toBe(false);
  });

  it('devuelve una lista vacía si ningún segmento califica', () => {
    const raw: RawSegmentAggregate[] = [
      { tipoContratacion: 'A', siglasDependencia: 'X', sampleSize: 1, medianAmount: 100, distinctSuppliers: 1, dominantSupplierShare: null },
    ];
    expect(normalizeAndScore(raw)).toEqual([]);
  });
});

describe('ComputeOpportunityScores', () => {
  class FakeOpportunityScoreRepository implements OpportunityScoreRepository {
    raw: RawSegmentAggregate[] = [];
    upserted: OpportunitySegmentStats[] = [];
    async computeRawSegmentAggregates() {
      return this.raw;
    }
    async upsertSegment(stats: OpportunitySegmentStats) {
      this.upserted.push(stats);
    }
    async findBySegment() {
      return null;
    }
  }

  it('agrega, normaliza, y hace upsert de cada segmento calificado', async () => {
    const repo = new FakeOpportunityScoreRepository();
    repo.raw = [
      { tipoContratacion: 'A', siglasDependencia: 'X', sampleSize: 3, medianAmount: 100, distinctSuppliers: 2, dominantSupplierShare: 70 },
      { tipoContratacion: 'B', siglasDependencia: 'Y', sampleSize: 1, medianAmount: 200, distinctSuppliers: 1, dominantSupplierShare: null },
    ];
    const usecase = new ComputeOpportunityScores({ repository: repo });

    const summary = await usecase.execute();

    expect(summary.segmentsEvaluated).toBe(2);
    expect(summary.segmentsScored).toBe(1); // el segmento B no califica (sampleSize=1)
    expect(repo.upserted).toHaveLength(1);
    expect(repo.upserted[0]!.tipoContratacion).toBe('A');
    expect(repo.upserted[0]!.isDominated).toBe(true);
  });

  it('no falla si no hay ningún segmento que califique', async () => {
    const repo = new FakeOpportunityScoreRepository();
    repo.raw = [];
    const usecase = new ComputeOpportunityScores({ repository: repo });
    const summary = await usecase.execute();
    expect(summary.segmentsEvaluated).toBe(0);
    expect(summary.segmentsScored).toBe(0);
    expect(repo.upserted).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Verificar que falla**

```bash
cd apps/backend && pnpm exec vitest run src/application/opportunities/compute-opportunity-scores.test.ts
```

Expected: FAIL — módulo no encontrado.

- [ ] **Step 3: Implementar**

Crear `apps/backend/src/application/opportunities/compute-opportunity-scores.ts`:

```ts
import type {
  OpportunityScoreRepository,
  RawSegmentAggregate,
  OpportunitySegmentStats,
} from '../../domain/repositories/opportunity-score-repository.js';
import { computeScore } from './opportunity-score-calculator.js';

/** Segmentos con menos contratos de respaldo que esto no reciben score. */
const MIN_SAMPLE_SIZE = 3;

/**
 * Normaliza (min-max, 0-100) los agregados crudos contra TODOS los segmentos
 * que califican en esta corrida, y calcula el score final de cada uno. Función
 * pura — sin I/O — para que sea testeable sin tocar la base de datos.
 */
export function normalizeAndScore(raw: RawSegmentAggregate[]): OpportunitySegmentStats[] {
  const qualifying = raw.filter((r) => r.sampleSize >= MIN_SAMPLE_SIZE);
  if (qualifying.length === 0) return [];

  const amounts = qualifying.map((r) => r.medianAmount);
  const minAmount = Math.min(...amounts);
  const maxAmount = Math.max(...amounts);

  const supplierCounts = qualifying.map((r) => r.distinctSuppliers);
  const minSuppliers = Math.min(...supplierCounts);
  const maxSuppliers = Math.max(...supplierCounts);

  return qualifying.map((r) => {
    const amountScore = normalize(r.medianAmount, minAmount, maxAmount);
    // Invertido: menos proveedores = menos competencia = score más alto.
    const competitionScore = 100 - normalize(r.distinctSuppliers, minSuppliers, maxSuppliers);
    const isDominated = (r.dominantSupplierShare ?? 0) >= 60;
    const { score } = computeScore({ amountScore, competitionScore, isDominated });

    return {
      tipoContratacion: r.tipoContratacion,
      siglasDependencia: r.siglasDependencia,
      sampleSize: r.sampleSize,
      medianAmount: r.medianAmount,
      amountScore,
      distinctSuppliers: r.distinctSuppliers,
      competitionScore,
      dominantSupplierShare: r.dominantSupplierShare,
      isDominated,
      score,
    };
  });
}

/** Min-max a 0-100. 50 (neutral) cuando no hay varianza (min === max). */
function normalize(value: number, min: number, max: number): number {
  if (max === min) return 50;
  return Math.round((100 * (value - min)) / (max - min));
}

export interface ComputeOpportunityScoresDeps {
  repository: OpportunityScoreRepository;
}

export interface ComputeOpportunityScoresSummary {
  segmentsEvaluated: number;
  segmentsScored: number;
}

/**
 * Caso de uso (PR14): agrega el histórico de contratos por segmento,
 * normaliza y calcula el score final, y persiste cada segmento calificado
 * vía upsert. Se dispara desde el mismo hook onScrapeComplete que ya usa
 * EvaluateAlerts — ver Task 5.
 */
export class ComputeOpportunityScores {
  constructor(private readonly deps: ComputeOpportunityScoresDeps) {}

  async execute(): Promise<ComputeOpportunityScoresSummary> {
    const raw = await this.deps.repository.computeRawSegmentAggregates();
    const scored = normalizeAndScore(raw);
    for (const row of scored) {
      await this.deps.repository.upsertSegment(row);
    }
    return { segmentsEvaluated: raw.length, segmentsScored: scored.length };
  }
}
```

- [ ] **Step 4: Correr el test y confirmar que pasa**

```bash
cd apps/backend && pnpm exec vitest run src/application/opportunities/compute-opportunity-scores.test.ts
```

Expected: 9/9 tests PASS.

- [ ] **Step 5: Typecheck + suite completa**

```bash
pnpm exec tsc --noEmit && pnpm test
```

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/application/opportunities/compute-opportunity-scores.ts apps/backend/src/application/opportunities/compute-opportunity-scores.test.ts
git commit -m "feat(score): agrega ComputeOpportunityScores (caso de uso de agregación)"
```

---

## Task 5: Wiring — enganchar al cron existente

**Files:**
- Modify: `apps/backend/src/presentation/server.ts`

**Interfaces:**
- Consumes: `ComputeOpportunityScores` (Task 4), `DrizzleOpportunityScoreRepository` (Task 2).
- Produces: el score se recalcula automáticamente tras cada scrape exitoso, junto a `EvaluateAlerts`.

- [ ] **Step 1: Agregar el import y el composition root**

Editar `apps/backend/src/presentation/server.ts`. Agregar el import junto a los de alertas:

```ts
import { DrizzleOpportunityScoreRepository } from '../infrastructure/db/repositories/opportunity-score-repository.js';
import { ComputeOpportunityScores } from '../application/opportunities/compute-opportunity-scores.js';
```

- [ ] **Step 2: Instanciar y enganchar dentro de `startServer()`**

El bloque actual de `startVigenteCron` en `startServer()` es:

```ts
  // Start the daily vigente scraper cron (configured via SCRAPE_CRON_*).
  startVigenteCron({
    // scrapeRunStartedAt no se pasa a execute(): la frescura de un match se
    // ancla a `search.createdAt` (instante fijo), no al inicio de la corrida
    // (que avanza cada día) — ver evaluate-alerts.ts. `now` usa su default
    // (new Date()) para la ventana de "cierre próximo".
    onScrapeComplete: async () => {
      try {
        const summary = await evaluateAlerts.execute();
        console.log(
          `[alerts] evaluó ${summary.searchesEvaluated} búsqueda(s), notificó a ${summary.usersNotified} usuario(s) (${summary.eventsDetected} evento(s))`,
        );
      } catch (err) {
        console.error('[alerts] falló la evaluación de alertas:', err);
      }
    },
  });
```

Reemplazarlo por (agrega el cálculo del score en su propio try/catch, sin afectar a `evaluateAlerts` si uno de los dos falla):

```ts
  // Score de oportunidad (PR14) — se recalcula tras cada scrape exitoso.
  const computeOpportunityScores = new ComputeOpportunityScores({
    repository: new DrizzleOpportunityScoreRepository(db),
  });

  // Start the daily vigente scraper cron (configured via SCRAPE_CRON_*).
  startVigenteCron({
    // scrapeRunStartedAt no se pasa a execute(): la frescura de un match se
    // ancla a `search.createdAt` (instante fijo), no al inicio de la corrida
    // (que avanza cada día) — ver evaluate-alerts.ts. `now` usa su default
    // (new Date()) para la ventana de "cierre próximo".
    onScrapeComplete: async () => {
      try {
        const summary = await evaluateAlerts.execute();
        console.log(
          `[alerts] evaluó ${summary.searchesEvaluated} búsqueda(s), notificó a ${summary.usersNotified} usuario(s) (${summary.eventsDetected} evento(s))`,
        );
      } catch (err) {
        console.error('[alerts] falló la evaluación de alertas:', err);
      }

      try {
        const summary = await computeOpportunityScores.execute();
        console.log(
          `[score] recalculó ${summary.segmentsScored} de ${summary.segmentsEvaluated} segmento(s) con datos suficientes`,
        );
      } catch (err) {
        console.error('[score] falló el recálculo del score de oportunidad:', err);
      }
    },
  });
```

- [ ] **Step 3: Typecheck + suite completa**

```bash
cd apps/backend && pnpm exec tsc --noEmit && pnpm test
```

- [ ] **Step 4: Verificación manual**

```bash
docker compose -f docker-compose.yml up -d && sleep 3 && cd apps/backend && pnpm db:migrate
SCRAPE_CRON_ENABLED=false pnpm dev &
sleep 2
curl -s http://localhost:3000/api/health
kill %1
```

Expected: el servidor arranca sin errores (el wiring nuevo no se ejecuta hasta que el cron corre, así que esto solo confirma que no rompió el arranque).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/presentation/server.ts
git commit -m "feat(score): conecta ComputeOpportunityScores al cron del scraper"
```

---

## Task 6: `GET /vigentes` expone el score

**Files:**
- Modify: `apps/backend/src/domain/repositories/vigente-repository.ts`
- Modify: `apps/backend/src/infrastructure/db/repositories/vigente-repository.ts`
- Modify: `apps/backend/src/presentation/routes/vigentes.ts`
- Test: `apps/backend/src/presentation/vigentes-score.integration.test.ts`

**Interfaces:**
- Consumes: tabla `opportunity_segment_stats` (Task 1).
- Produces: `score`/`score_breakdown` en cada fila de `GET /vigentes`, parámetro `sort=score` — usado por Task 7 (frontend).

- [ ] **Step 1: Agregar `score`/`scoreBreakdown` a `VigenteRecord` y el parámetro `sort` a `list()`**

Editar `apps/backend/src/domain/repositories/vigente-repository.ts`. Agregar (después de `createdAt`, dentro de `VigenteRecord`):

```ts
  createdAt: Date;
  /** Score de oportunidad 0-100 (PR14), o null si el segmento no tiene datos históricos suficientes. */
  score: number | null;
  scoreBreakdown: VigenteScoreBreakdown | null;
}

export interface VigenteScoreBreakdown {
  amountScore: number;
  competitionScore: number;
  isDominated: boolean;
  sampleSize: number;
}

/** (el resto de las interfaces del archivo sigue igual hasta acá) */
```

(Nota: el fragmento de arriba muestra dónde insertar el cierre de `VigenteRecord` — la llave de cierre `}` original se mueve al final del nuevo campo `scoreBreakdown`, y la interfaz `VigenteScoreBreakdown` se agrega justo después, antes de `UpsertVigenteInput`.)

Modificar la firma de `list` en la interfaz `VigenteRepository`:

```ts
  /** Filtrado + paginado. `sort` por defecto ordena por fecha límite (más urgente primero); 'score' ordena por score de oportunidad descendente. */
  list(filter: VigenteFilter, page: number, pageSize: number, sort?: 'urgency' | 'score'): Promise<VigentePage>;
```

- [ ] **Step 2: Extender `DrizzleVigenteRepository`**

Editar `apps/backend/src/infrastructure/db/repositories/vigente-repository.ts`. Agregar el import de la tabla de score:

```ts
import { vigenteProcedures, opportunitySegmentStats } from '../../../db/schema/index.js';
```

Modificar `toRecord` para incluir los campos de score con default `null` (usado por `getByNumero`, que no hace join):

```ts
function toRecord(row: typeof vigenteProcedures.$inferSelect): VigenteRecord {
  return {
    id: row.id,
    numeroProcedimiento: row.numeroProcedimiento,
    nombre: row.nombre,
    caracter: row.caracter,
    dependencia: row.dependencia,
    siglasDependencia: row.siglasDependencia,
    estatus: row.estatus,
    fechaJuntaAclaraciones: row.fechaJuntaAclaraciones,
    fechaPresentacionApertura: row.fechaPresentacionApertura,
    tipoProcedimiento: row.tipoProcedimiento,
    tipoContratacion: row.tipoContratacion,
    unidadCompradora: row.unidadCompradora,
    codigoExpediente: row.codigoExpediente,
    uuidProcedimiento: row.uuidProcedimiento,
    direccionesAnuncio: row.direccionesAnuncio,
    entidadFederativa: row.entidadFederativa,
    scrapedAt: row.scrapedAt,
    createdAt: row.createdAt,
    score: null,
    scoreBreakdown: null,
  };
}
```

Reemplazar el método `list` completo:

```ts
  async list(
    filter: VigenteFilter,
    page: number,
    pageSize: number,
    sort: 'urgency' | 'score' = 'urgency',
  ): Promise<VigentePage> {
    const where = buildFilter(filter);

    const totalRow = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(vigenteProcedures)
      .where(where ?? sql`true`);
    const total = totalRow[0]?.total ?? 0;

    const { offset, limit, meta } = computePagination(page, pageSize, total);

    // Postgres pone los NULL primero en DESC por default — hay que forzarlo
    // explícito para que las vigentes sin score no salgan arriba de las que sí tienen.
    const orderBy =
      sort === 'score'
        ? [sql`${opportunitySegmentStats.score} DESC NULLS LAST`, asc(vigenteProcedures.fechaPresentacionApertura)]
        : [asc(vigenteProcedures.fechaPresentacionApertura), asc(vigenteProcedures.numeroProcedimiento)];

    const rows = await this.db
      .select({
        vigente: vigenteProcedures,
        amountScore: opportunitySegmentStats.amountScore,
        competitionScore: opportunitySegmentStats.competitionScore,
        isDominated: opportunitySegmentStats.isDominated,
        sampleSize: opportunitySegmentStats.sampleSize,
        score: opportunitySegmentStats.score,
      })
      .from(vigenteProcedures)
      .leftJoin(
        opportunitySegmentStats,
        and(
          eq(opportunitySegmentStats.tipoContratacion, vigenteProcedures.tipoContratacion),
          eq(opportunitySegmentStats.siglasDependencia, vigenteProcedures.siglasDependencia),
        ),
      )
      .where(where ?? sql`true`)
      .orderBy(...orderBy)
      .limit(limit)
      .offset(offset);

    const data = rows.map((r) => {
      const base = toRecord(r.vigente);
      if (r.score == null) return base;
      return {
        ...base,
        score: r.score,
        scoreBreakdown: {
          amountScore: r.amountScore!,
          competitionScore: r.competitionScore!,
          isDominated: r.isDominated!,
          sampleSize: r.sampleSize!,
        },
      };
    });

    return { data, pagination: meta };
  }
```

- [ ] **Step 3: Extender el router**

Editar `apps/backend/src/presentation/routes/vigentes.ts`. Agregar `sort` al schema de query:

```ts
  const listQuery = z.object({
    page: z.coerce.number().int().min(1).default(1),
    page_size: z.coerce.number().int().min(1).max(100).default(20),
    tipo_contratacion: z.string().trim().optional(),
    tipo_procedimiento: z.string().trim().optional(),
    dependencia: z.string().trim().optional(),
    siglas: z.string().trim().optional(),
    entidad_federativa: z.string().trim().optional(),
    q: z.string().trim().optional(),
    sort: z.enum(['urgency', 'score']).default('urgency'),
  });
```

Pasar `q.sort` a `deps.repository.list`:

```ts
      const page = await deps.repository.list(
        {
          tipoContratacion: q.tipo_contratacion,
          tipoProcedimiento: q.tipo_procedimiento,
          dependencia: q.dependencia,
          siglas: q.siglas,
          entidadFederativa: q.entidad_federativa,
          q: q.q,
        },
        q.page,
        q.page_size,
        q.sort,
      );
```

Extender `serialize`:

```ts
function serialize(r: VigenteRecord) {
  return {
    id: r.id,
    numero_procedimiento: r.numeroProcedimiento,
    nombre: r.nombre,
    caracter: r.caracter,
    dependencia: r.dependencia,
    siglas_dependencia: r.siglasDependencia,
    estatus: r.estatus,
    fecha_junta_aclaraciones: r.fechaJuntaAclaraciones ? r.fechaJuntaAclaraciones.toISOString() : null,
    fecha_presentacion_apertura: r.fechaPresentacionApertura
      ? r.fechaPresentacionApertura.toISOString()
      : null,
    tipo_procedimiento: r.tipoProcedimiento,
    tipo_contratacion: r.tipoContratacion,
    unidad_compradora: r.unidadCompradora,
    codigo_expediente: r.codigoExpediente,
    uuid_procedimiento: r.uuidProcedimiento,
    direcciones_anuncio: r.direccionesAnuncio,
    entidad_federativa: r.entidadFederativa,
    scraped_at: r.scrapedAt.toISOString(),
    score: r.score,
    score_breakdown: r.scoreBreakdown
      ? {
          amount_score: r.scoreBreakdown.amountScore,
          competition_score: r.scoreBreakdown.competitionScore,
          is_dominated: r.scoreBreakdown.isDominated,
          sample_size: r.scoreBreakdown.sampleSize,
        }
      : null,
  };
}
```

- [ ] **Step 4: Escribir el test de integración**

Crear `apps/backend/src/presentation/vigentes-score.integration.test.ts`. Siembra un segmento en `opportunity_segment_stats` y una vigente que matchea, más una vigente sin match, y confirma la serialización + el orden con `sort=score`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { eq } from 'drizzle-orm';
import { createApp } from './server.js';
import { pool, db } from '../db/client.js';
import { vigenteProcedures, opportunitySegmentStats } from '../db/schema/index.js';

const app = createApp();
const server = http.createServer(app);
let baseUrl = '';

const TEST_TIPO = '__TEST_SCORE_TIPO__';
const TEST_SIGLAS = '__TEST_SCORE_SIGLAS__';

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.delete(vigenteProcedures).where(eq(vigenteProcedures.tipoContratacion, TEST_TIPO));
  await db.delete(opportunitySegmentStats).where(eq(opportunitySegmentStats.tipoContratacion, TEST_TIPO));
  await pool.end();
});

beforeEach(async () => {
  await db.delete(vigenteProcedures).where(eq(vigenteProcedures.tipoContratacion, TEST_TIPO));
  await db.delete(opportunitySegmentStats).where(eq(opportunitySegmentStats.tipoContratacion, TEST_TIPO));

  await db.insert(opportunitySegmentStats).values({
    tipoContratacion: TEST_TIPO,
    siglasDependencia: TEST_SIGLAS,
    sampleSize: 5,
    medianAmount: '1000.00',
    amountScore: 80,
    distinctSuppliers: 2,
    competitionScore: 70,
    dominantSupplierShare: '10.00',
    isDominated: false,
    score: 76,
  });

  await db.insert(vigenteProcedures).values([
    {
      numeroProcedimiento: '__TEST_SCORE_CON_MATCH__',
      tipoContratacion: TEST_TIPO,
      siglasDependencia: TEST_SIGLAS,
    },
    {
      numeroProcedimiento: '__TEST_SCORE_SIN_MATCH__',
      tipoContratacion: TEST_TIPO,
      siglasDependencia: '__TEST_SIGLAS_SIN_SEGMENTO__',
    },
  ]);
});

async function get(path: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`);
}

describe('GET /vigentes — score de oportunidad', () => {
  it('incluye score y score_breakdown cuando el segmento tiene datos', async () => {
    const res = await get(`/api/vigentes?q=${encodeURIComponent('__TEST_SCORE_CON_MATCH__')}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { numero_procedimiento: string; score: number | null; score_breakdown: unknown }[] };
    const row = body.data.find((r) => r.numero_procedimiento === '__TEST_SCORE_CON_MATCH__');
    expect(row).toBeDefined();
    expect(row!.score).toBe(76);
    expect(row!.score_breakdown).toEqual({
      amount_score: 80,
      competition_score: 70,
      is_dominated: false,
      sample_size: 5,
    });
  });

  it('score y score_breakdown son null cuando el segmento no tiene datos', async () => {
    const res = await get(`/api/vigentes?q=${encodeURIComponent('__TEST_SCORE_SIN_MATCH__')}`);
    const body = (await res.json()) as { data: { numero_procedimiento: string; score: number | null; score_breakdown: unknown }[] };
    const row = body.data.find((r) => r.numero_procedimiento === '__TEST_SCORE_SIN_MATCH__');
    expect(row).toBeDefined();
    expect(row!.score).toBeNull();
    expect(row!.score_breakdown).toBeNull();
  });

  it('sort=score ordena descendente y NULLS LAST', async () => {
    const res = await get(`/api/vigentes?tipo_contratacion=${encodeURIComponent(TEST_TIPO)}&sort=score&page_size=10`);
    const body = (await res.json()) as { data: { numero_procedimiento: string; score: number | null }[] };
    const numeros = body.data.map((r) => r.numero_procedimiento);
    expect(numeros.indexOf('__TEST_SCORE_CON_MATCH__')).toBeLessThan(numeros.indexOf('__TEST_SCORE_SIN_MATCH__'));
  });
});
```

- [ ] **Step 5: Correr el test y confirmar que pasa**

```bash
cd apps/backend && pnpm exec vitest run src/presentation/vigentes-score.integration.test.ts
```

Expected: 3/3 tests PASS.

- [ ] **Step 6: Typecheck + suite completa**

```bash
pnpm exec tsc --noEmit && pnpm test
```

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/domain/repositories/vigente-repository.ts apps/backend/src/infrastructure/db/repositories/vigente-repository.ts apps/backend/src/presentation/routes/vigentes.ts apps/backend/src/presentation/vigentes-score.integration.test.ts
git commit -m "feat(score): expone score y score_breakdown en GET /vigentes"
```

---

## Task 7: Frontend — columna de score en Oportunidades

**Files:**
- Modify: `apps/frontend/src/types/index.ts`
- Modify: `apps/frontend/src/api/queries.ts`
- Modify: `apps/frontend/src/pages/OpportunitiesPage.tsx`

**Interfaces:**
- Consumes: `score`/`score_breakdown` de `GET /vigentes` (Task 6).

- [ ] **Step 1: Extender `VigenteItem`**

Editar `apps/frontend/src/types/index.ts`. En `VigenteItem` (sección `// --- Vigente procedures (PR7...) ---`), agregar después de `scraped_at`:

```ts
  scraped_at: string;
  score: number | null;
  score_breakdown: {
    amount_score: number;
    competition_score: number;
    is_dominated: boolean;
    sample_size: number;
  } | null;
}
```

- [ ] **Step 2: Agregar `sort` a `VigenteListQuery`**

Editar `apps/frontend/src/api/queries.ts`. En `VigenteListQuery`, agregar:

```ts
export interface VigenteListQuery {
  page: number;
  page_size: number;
  tipo_contratacion?: string;
  tipo_procedimiento?: string;
  dependencia?: string;
  siglas?: string;
  entidad_federativa?: string;
  q?: string;
  sort?: 'urgency' | 'score';
}
```

(`pruneVigente` ya es genérico — no necesita cambios.)

- [ ] **Step 3: Columna de score en `OpportunitiesPage.tsx`**

Editar `apps/frontend/src/pages/OpportunitiesPage.tsx`. Agregar un toggle de orden y la columna. Primero, el estado y el paso de `sort` a `useVigentes` — modificar el inicio de `OpportunitiesPage`:

```tsx
export function OpportunitiesPage() {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [tipoContratacion, setTipoContratacion] = useState('');
  const [tipoProcedimiento, setTipoProcedimiento] = useState('');
  const [dependencia, setDependencia] = useState('');
  const [sortByScore, setSortByScore] = useState(false);
  const [applied, setApplied] = useState<{
    q: string;
    tipo: string;
    proc: string;
    dep: string;
  }>({ q: '', tipo: '', proc: '', dep: '' });

  // PR8: the currently-selected procedure whose detail drawer is open (null = closed).
  const [selected, setSelected] = useState<VigenteItem | null>(null);

  const vigentes = useVigentes({
    page,
    page_size: PAGE_SIZE,
    q: applied.q || undefined,
    tipo_contratacion: applied.tipo || undefined,
    tipo_procedimiento: applied.proc || undefined,
    dependencia: applied.dep || undefined,
    sort: sortByScore ? 'score' : undefined,
  });
```

Agregar el botón de orden junto al de "Actualizar datos" (en el `div` con `className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"`, después del `<Button>` de actualizar):

```tsx
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setSortByScore((v) => !v);
            setPage(1);
          }}
        >
          {sortByScore ? '✓ Ordenado por score' : 'Ordenar por score'}
        </Button>
```

Agregar la columna "Score" en `VigentesTable` — header:

```tsx
            <th className="px-5 py-3">Procedimiento</th>
            <th className="px-5 py-3">Dependencia</th>
            <th className="px-5 py-3">Tipo</th>
            <th className="px-5 py-3">Presentación</th>
            <th className="px-5 py-3 text-right">Score</th>
            <th className="px-5 py-3 text-right">Días restantes</th>
```

Y la celda correspondiente, antes de la celda de "Días restantes":

```tsx
                <td className="px-5 py-3 text-right align-top">
                  {r.score == null ? (
                    <span className="text-xs text-slate-400" title="No hay suficientes contratos históricos en este segmento para calcular un score confiable.">
                      Sin datos
                    </span>
                  ) : (
                    <span
                      title={`Monto: ${r.score_breakdown!.amount_score} · Competencia: ${r.score_breakdown!.competition_score}${r.score_breakdown!.is_dominated ? ' · Proveedor dominante' : ''} · ${r.score_breakdown!.sample_size} contratos históricos`}
                    >
                      <Badge tone={r.score >= 70 ? 'success' : r.score >= 40 ? 'neutral' : 'warning'}>
                        {r.score}
                      </Badge>
                    </span>
                  )}
                </td>
```

- [ ] **Step 4: Typecheck**

```bash
cd apps/frontend && pnpm exec tsc --noEmit
```

- [ ] **Step 5: Verificación en el navegador**

Levantar backend + Postgres + frontend dev server (mismo flujo que en PR13). En el navegador:

1. Ir a `/oportunidades` → confirmar que aparece la columna "Score" (o "Sin datos" si no hay segmentos calculados todavía — esperable si `ComputeOpportunityScores` nunca corrió en este entorno de prueba).
2. Si hay datos: hacer hover sobre un badge de score → confirmar que el tooltip muestra el desglose.
3. Click en "Ordenar por score" → confirmar que la lista se reordena y el botón cambia a "✓ Ordenado por score".
4. Para ver scores reales sin esperar al cron: insertar manualmente una fila de prueba en `opportunity_segment_stats` que matchee el `tipo_contratacion`/`siglas_dependencia` de alguna vigente real de la lista (vía `psql`), refrescar, y confirmar que esa fila específica muestra el score insertado.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/types/index.ts apps/frontend/src/api/queries.ts apps/frontend/src/pages/OpportunitiesPage.tsx
git commit -m "feat(score): agrega columna de score y orden por score en Oportunidades"
```

---

## Verificación final (todas las tareas completas)

- [ ] `cd apps/backend && pnpm exec tsc --noEmit && pnpm test` → typecheck limpio, todos los tests pasan.
- [ ] `cd apps/frontend && pnpm exec tsc --noEmit` → typecheck limpio.
- [ ] Verificación manual en navegador (Task 7, Step 5).
- [ ] Forzar una corrida real de `ComputeOpportunityScores` contra datos históricos reales (no solo el dataset sembrado de los tests) y confirmar que los scores resultantes son razonables — esto no se puede verificar en este plan porque el dev DB local no tiene el dataset histórico completo cargado.
- [ ] Limpieza de artefactos de prueba: `docker compose -f docker-compose.yml down`.
- [ ] Revisar el diff completo antes de hacer push.
