# Alertas por Email — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada usuario del panel admin puede guardar criterios de búsqueda sobre licitaciones vigentes y recibir un correo digest cuando aparece una nueva coincidencia, una coincidencia existente está por cerrar, o cambia de estatus.

**Architecture:** Arquitectura hexagonal existente (dominio → aplicación → infraestructura → presentación). La evaluación de alertas se dispara pegada al cron diario existente del scraper de vigentes (`vigente-cron.ts`), corre en el proceso del servidor (no en el child process del scraper), y envía un digest por usuario vía la API HTTP de Elastic Email.

**Tech Stack:** Express + TypeScript, Drizzle ORM + Postgres, Zod, Vitest, React + TanStack Query (frontend). Sin dependencias nuevas — Elastic Email se llama con `fetch` nativo (Node 22).

**Spec:** [docs/superpowers/specs/2026-09-01-alertas-por-email-design.md](../specs/2026-09-01-alertas-por-email-design.md)

## Global Constraints

- Todos los archivos backend nuevos siguen el patrón hexagonal existente: `domain/repositories/*.ts` (interfaces), `infrastructure/db/repositories/*.ts` (Drizzle), `application/*/*.ts` (casos de uso), `presentation/routes/*.ts` (Express).
- Imports de schema/domain usan extensión `.js` en los imports TS (ESM), igual que el resto del backend.
- Ningún test manda correo real — el `EmailSender` siempre se mockea/fake-ea en tests.
- Cada tarea termina con `pnpm exec tsc --noEmit` limpio en `apps/backend` (o `apps/frontend` para las tareas de frontend) antes de commitear.
- Commits en español, siguiendo el estilo de mensajes ya usado en el repo (`feat(alertas): ...`, `fix(alertas): ...`).

---

## Task 1: Schema — `users.email`, `saved_searches`, `saved_search_matches`

**Files:**
- Modify: `apps/backend/src/db/schema/users.ts`
- Create: `apps/backend/src/db/schema/saved-searches.ts`
- Create: `apps/backend/src/db/schema/saved-search-matches.ts`
- Modify: `apps/backend/src/db/schema/index.ts`
- Create (generated): `apps/backend/drizzle/migrations/000X_<nombre-generado>.sql`

**Interfaces:**
- Produces: columna `users.email` (text, nullable, unique), tabla `saved_searches` (id, user_id, name, filters jsonb, active, created_at), tabla `saved_search_matches` (id, saved_search_id, vigente_id, last_estatus, closing_soon_notified_at, created_at, UNIQUE(saved_search_id, vigente_id)).

- [ ] **Step 1: Agregar `email` a `users`**

Editar `apps/backend/src/db/schema/users.ts`:

```ts
import { pgTable, serial, text, boolean, timestamp } from 'drizzle-orm/pg-core';
import { createdAt } from './_shared';

/**
 * Portal login accounts (PR12). Every user has the same access — there are
 * no roles — so this is closer to a shared team allowlist than a
 * permissions system. The first row is seeded at boot from
 * ADMIN_USERNAME/ADMIN_PASSWORD if the table is empty (see
 * infrastructure/auth/bootstrap-admin.ts); after that, those env vars are
 * inert and accounts are managed entirely from /admin/users.
 */
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  /** Destino de las alertas por email (PR13). Null = sin alertas configuradas. */
  email: text('email').unique(),
  active: boolean('active').notNull().default(true),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: createdAt(),
});
```

- [ ] **Step 2: Crear `saved_searches`**

Crear `apps/backend/src/db/schema/saved-searches.ts`:

```ts
import { pgTable, serial, integer, text, jsonb, boolean, index } from 'drizzle-orm/pg-core';
import { createdAt } from './_shared';
import { users } from './users';

/**
 * Búsquedas guardadas por usuario sobre `vigente_procedures` (PR13). Mismo
 * shape de filtros que ya acepta `GET /vigentes`, guardado como jsonb (sin
 * `.$type<>()` — el mapeo a tipos de dominio vive en el repositorio, igual
 * que `vigente_procedures.raw_data`) para no requerir una migración de
 * schema si se agrega un filtro nuevo.
 */
export const savedSearches = pgTable(
  'saved_searches',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    filters: jsonb('filters').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (table) => [index('saved_searches_user_id_idx').on(table.userId)],
);
```

- [ ] **Step 3: Crear `saved_search_matches`**

Crear `apps/backend/src/db/schema/saved-search-matches.ts`:

```ts
import { pgTable, serial, integer, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAt } from './_shared';
import { savedSearches } from './saved-searches';
import { vigenteProcedures } from './vigente-procedures';

/**
 * Estado de "qué vigentes ya vimos para cuál búsqueda guardada" (PR13). Esta
 * tabla cumple doble función:
 *  - Evita re-notificar el mismo evento (existencia de la fila = ya se vio
 *    esta vigente para esta búsqueda; `closing_soon_notified_at` = ya se
 *    avisó el cierre próximo una vez).
 *  - Guarda el último estatus conocido para detectar cambios.
 */
export const savedSearchMatches = pgTable(
  'saved_search_matches',
  {
    id: serial('id').primaryKey(),
    savedSearchId: integer('saved_search_id')
      .notNull()
      .references(() => savedSearches.id, { onDelete: 'cascade' }),
    vigenteId: integer('vigente_id')
      .notNull()
      .references(() => vigenteProcedures.id, { onDelete: 'cascade' }),
    lastEstatus: text('last_estatus'),
    closingSoonNotifiedAt: timestamp('closing_soon_notified_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('saved_search_matches_search_vigente_idx').on(table.savedSearchId, table.vigenteId),
  ],
);
```

- [ ] **Step 4: Exportar las tablas nuevas**

Editar `apps/backend/src/db/schema/index.ts`, agregar al final:

```ts
export { savedSearches } from './saved-searches';
export { savedSearchMatches } from './saved-search-matches';
```

- [ ] **Step 5: Generar la migración**

```bash
cd apps/backend && pnpm db:generate
```

**Verificación crítica** (ya pasó esto en PR12 con la tabla `users` — confirmar que no se repite el problema de PR11 donde `drizzle-kit` intentó recrear `vigente_procedures` desde cero): abrir el archivo `.sql` generado en `apps/backend/drizzle/migrations/` y confirmar que contiene **exactamente**:
- `ALTER TABLE "users" ADD COLUMN "email" text; ALTER TABLE "users" ADD CONSTRAINT ... UNIQUE("email");` (o el DDL equivalente que genere Drizzle para una columna unique nueva)
- `CREATE TABLE "saved_searches" (...)`
- `CREATE TABLE "saved_search_matches" (...)` con sus dos FKs y el índice único

Si el archivo contiene cualquier DDL sobre tablas no relacionadas (`procedures`, `vigente_procedures`, `contracts`, etc.), **parar** y no continuar — investigar la cadena de snapshots antes de aplicar la migración.

- [ ] **Step 6: Aplicar la migración contra la DB de desarrollo**

```bash
docker compose -f docker-compose.yml up -d
sleep 3
cd apps/backend && pnpm db:migrate
```

Expected: `[migrate] done.` sin errores.

- [ ] **Step 7: Verificar las tablas por SQL directo**

```bash
docker exec tecnolicity-postgres psql -U tecnolicity -d tecnolicity -c "\d users" -c "\d saved_searches" -c "\d saved_search_matches"
```

Expected: `users` muestra la columna `email`; `saved_searches` y `saved_search_matches` existen con las columnas y constraints descritas arriba.

- [ ] **Step 8: Typecheck + suite completa**

```bash
cd apps/backend && pnpm exec tsc --noEmit && pnpm test
```

Expected: typecheck limpio, 195/195 tests existentes siguen pasando (todavía no hay tests nuevos — se agregan en las tareas siguientes).

- [ ] **Step 9: Commit**

```bash
git add apps/backend/src/db/schema/users.ts apps/backend/src/db/schema/saved-searches.ts apps/backend/src/db/schema/saved-search-matches.ts apps/backend/src/db/schema/index.ts apps/backend/drizzle/migrations/
git commit -m "feat(alertas): agrega schema de users.email, saved_searches y saved_search_matches"
```

---

## Task 2: `SavedSearchRepository` (dominio + Drizzle)

**Files:**
- Create: `apps/backend/src/domain/repositories/saved-search-repository.ts`
- Create: `apps/backend/src/infrastructure/db/repositories/saved-search-repository.ts`
- Test: `apps/backend/src/infrastructure/db/repositories/saved-search-repository.integration.test.ts`

**Interfaces:**
- Consumes: tabla `saved_searches` (Task 1).
- Produces: `SavedSearchRepository`, `SavedSearchRecord`, `SavedSearchFilters`, `CreateSavedSearchInput`, `UpdateSavedSearchInput`, `DrizzleSavedSearchRepository` — usados por Task 6 (EvaluateAlerts) y Task 7 (router).

- [ ] **Step 1: Escribir la interfaz de dominio**

Crear `apps/backend/src/domain/repositories/saved-search-repository.ts`:

```ts
/**
 * SavedSearchRepository — dominio port para `saved_searches` (PR13). Cada
 * fila pertenece a un usuario; los filtros son el mismo shape que ya acepta
 * `GET /vigentes`.
 */

export interface SavedSearchFilters {
  tipoContratacion?: string;
  tipoProcedimiento?: string;
  dependencia?: string;
  siglas?: string;
  entidadFederativa?: string;
  q?: string;
}

export interface SavedSearchRecord {
  id: number;
  userId: number;
  name: string;
  filters: SavedSearchFilters;
  active: boolean;
  createdAt: Date;
}

export interface CreateSavedSearchInput {
  userId: number;
  name: string;
  filters: SavedSearchFilters;
}

export interface UpdateSavedSearchInput {
  name?: string;
  filters?: SavedSearchFilters;
  active?: boolean;
}

export interface SavedSearchRepository {
  listByUser(userId: number): Promise<SavedSearchRecord[]>;
  /** Todas las búsquedas activas de todos los usuarios — usado por EvaluateAlerts. */
  listActive(): Promise<SavedSearchRecord[]>;
  findById(id: number): Promise<SavedSearchRecord | null>;
  create(input: CreateSavedSearchInput): Promise<SavedSearchRecord>;
  update(id: number, patch: UpdateSavedSearchInput): Promise<SavedSearchRecord | null>;
  delete(id: number): Promise<boolean>;
}
```

- [ ] **Step 2: Escribir el test de integración (fallando)**

Crear `apps/backend/src/infrastructure/db/repositories/saved-search-repository.integration.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, pool } from '../../../db/client.js';
import { savedSearches, users } from '../../../db/schema/index.js';
import { DrizzleSavedSearchRepository } from './saved-search-repository.js';

const repo = new DrizzleSavedSearchRepository(db);
let testUserId: number;

beforeEach(async () => {
  await db.delete(savedSearches).where(eq(savedSearches.name, '__test_saved_search__'));
  const [user] = await db
    .insert(users)
    .values({
      username: `__test_saved_search_user_${Date.now()}_${Math.random()}`,
      passwordHash: 'x',
    })
    .returning();
  testUserId = user!.id;
});

afterAll(async () => {
  await pool.end();
});

describe('DrizzleSavedSearchRepository', () => {
  it('creates and reads back a saved search with its filters', async () => {
    const created = await repo.create({
      userId: testUserId,
      name: '__test_saved_search__',
      filters: { tipoContratacion: 'ADQUISICIONES', q: 'software' },
    });

    expect(created.id).toBeGreaterThan(0);
    expect(created.userId).toBe(testUserId);
    expect(created.active).toBe(true);
    expect(created.filters).toEqual({ tipoContratacion: 'ADQUISICIONES', q: 'software' });

    const found = await repo.findById(created.id);
    expect(found).toEqual(created);
  });

  it('listByUser only returns that user\'s searches', async () => {
    const other = await db
      .insert(users)
      .values({ username: `__test_other_${Date.now()}`, passwordHash: 'x' })
      .returning();

    await repo.create({ userId: testUserId, name: '__test_saved_search__', filters: {} });
    await repo.create({ userId: other[0]!.id, name: '__test_saved_search__', filters: {} });

    const mine = await repo.listByUser(testUserId);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.userId).toBe(testUserId);

    await db.delete(users).where(eq(users.id, other[0]!.id));
  });

  it('listActive excludes inactive searches', async () => {
    const active = await repo.create({ userId: testUserId, name: '__test_saved_search__', filters: {} });
    const inactive = await repo.create({ userId: testUserId, name: '__test_saved_search__', filters: {} });
    await repo.update(inactive.id, { active: false });

    const activeOnes = await repo.listActive();
    const ids = activeOnes.map((s) => s.id);
    expect(ids).toContain(active.id);
    expect(ids).not.toContain(inactive.id);
  });

  it('update patches name/filters/active independently', async () => {
    const created = await repo.create({ userId: testUserId, name: '__test_saved_search__', filters: { q: 'a' } });

    const renamed = await repo.update(created.id, { name: '__test_saved_search__ renamed' });
    expect(renamed?.name).toBe('__test_saved_search__ renamed');
    expect(renamed?.filters).toEqual({ q: 'a' });

    const refiltered = await repo.update(created.id, { filters: { q: 'b' } });
    expect(refiltered?.filters).toEqual({ q: 'b' });
  });

  it('delete removes the row and returns false for an unknown id', async () => {
    const created = await repo.create({ userId: testUserId, name: '__test_saved_search__', filters: {} });
    expect(await repo.delete(created.id)).toBe(true);
    expect(await repo.findById(created.id)).toBeNull();
    expect(await repo.delete(999999)).toBe(false);
  });
});
```

- [ ] **Step 3: Verificar que falla**

```bash
cd apps/backend && pnpm exec vitest run src/infrastructure/db/repositories/saved-search-repository.integration.test.ts
```

Expected: FAIL — `Cannot find module './saved-search-repository.js'`.

- [ ] **Step 4: Implementar `DrizzleSavedSearchRepository`**

Crear `apps/backend/src/infrastructure/db/repositories/saved-search-repository.ts`:

```ts
import { eq, and } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../../db/schema/index.js';
import { savedSearches } from '../../../db/schema/index.js';
import type {
  SavedSearchRepository,
  SavedSearchRecord,
  SavedSearchFilters,
  CreateSavedSearchInput,
  UpdateSavedSearchInput,
} from '../../../domain/repositories/saved-search-repository.js';

type Db = NodePgDatabase<typeof schema>;

function toRecord(row: typeof savedSearches.$inferSelect): SavedSearchRecord {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    filters: row.filters as SavedSearchFilters,
    active: row.active,
    createdAt: row.createdAt,
  };
}

export class DrizzleSavedSearchRepository implements SavedSearchRepository {
  constructor(private readonly db: Db) {}

  async listByUser(userId: number): Promise<SavedSearchRecord[]> {
    const rows = await this.db.select().from(savedSearches).where(eq(savedSearches.userId, userId));
    return rows.map(toRecord);
  }

  async listActive(): Promise<SavedSearchRecord[]> {
    const rows = await this.db.select().from(savedSearches).where(eq(savedSearches.active, true));
    return rows.map(toRecord);
  }

  async findById(id: number): Promise<SavedSearchRecord | null> {
    const [row] = await this.db.select().from(savedSearches).where(eq(savedSearches.id, id)).limit(1);
    return row ? toRecord(row) : null;
  }

  async create(input: CreateSavedSearchInput): Promise<SavedSearchRecord> {
    const [row] = await this.db
      .insert(savedSearches)
      .values({ userId: input.userId, name: input.name, filters: input.filters })
      .returning();
    return toRecord(row!);
  }

  async update(id: number, patch: UpdateSavedSearchInput): Promise<SavedSearchRecord | null> {
    const [row] = await this.db
      .update(savedSearches)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.filters !== undefined ? { filters: patch.filters } : {}),
        ...(patch.active !== undefined ? { active: patch.active } : {}),
      })
      .where(eq(savedSearches.id, id))
      .returning();
    return row ? toRecord(row) : null;
  }

  async delete(id: number): Promise<boolean> {
    const rows = await this.db.delete(savedSearches).where(eq(savedSearches.id, id)).returning({ id: savedSearches.id });
    return rows.length > 0;
  }
}
```

Nota: `and` se importa pero no se usa en este archivo — quitar el import si `tsc`/eslint se queja (dejar solo `eq`).

- [ ] **Step 5: Correr el test y confirmar que pasa**

```bash
docker compose -f docker-compose.yml up -d && sleep 3 && cd apps/backend && pnpm db:migrate
pnpm exec vitest run src/infrastructure/db/repositories/saved-search-repository.integration.test.ts
```

Expected: 5/5 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/domain/repositories/saved-search-repository.ts apps/backend/src/infrastructure/db/repositories/saved-search-repository.ts apps/backend/src/infrastructure/db/repositories/saved-search-repository.integration.test.ts
git commit -m "feat(alertas): agrega SavedSearchRepository (dominio + Drizzle)"
```

---

## Task 3: `SavedSearchMatchRepository` (dominio + Drizzle)

**Files:**
- Create: `apps/backend/src/domain/repositories/saved-search-match-repository.ts`
- Create: `apps/backend/src/infrastructure/db/repositories/saved-search-match-repository.ts`
- Test: `apps/backend/src/infrastructure/db/repositories/saved-search-match-repository.integration.test.ts`

**Interfaces:**
- Consumes: `SavedSearchRepository` (Task 2, para crear una búsqueda de prueba), tabla `saved_search_matches` (Task 1), tabla `vigente_procedures` (existente).
- Produces: `SavedSearchMatchRepository`, `SavedSearchMatchRecord`, `AlertEventType`, `DrizzleSavedSearchMatchRepository` — usados por Task 6.

- [ ] **Step 1: Escribir la interfaz de dominio**

Crear `apps/backend/src/domain/repositories/saved-search-match-repository.ts`:

```ts
/**
 * SavedSearchMatchRepository — dominio port para `saved_search_matches`
 * (PR13). Guarda el estado "qué vigente ya vimos para cuál búsqueda" y evita
 * re-notificar el mismo evento dos veces.
 */

export type AlertEventType = 'new_match' | 'closing_soon' | 'status_change';

export interface SavedSearchMatchRecord {
  id: number;
  savedSearchId: number;
  vigenteId: number;
  lastEstatus: string | null;
  closingSoonNotifiedAt: Date | null;
  createdAt: Date;
}

export interface SavedSearchMatchRepository {
  /** Fila de estado para el par (búsqueda, vigente), o null si nunca se vio. */
  findState(savedSearchId: number, vigenteId: number): Promise<SavedSearchMatchRecord | null>;
  /** Crea la fila base la primera vez que una vigente se ve para una búsqueda. */
  createState(savedSearchId: number, vigenteId: number, estatus: string | null): Promise<void>;
  /** Actualiza el último estatus conocido (tras notificar un status_change). */
  updateEstatus(savedSearchId: number, vigenteId: number, estatus: string | null): Promise<void>;
  /** Marca que ya se avisó el cierre próximo (no se debe repetir). */
  markClosingSoonNotified(savedSearchId: number, vigenteId: number): Promise<void>;
}
```

- [ ] **Step 2: Escribir el test de integración (fallando)**

Crear `apps/backend/src/infrastructure/db/repositories/saved-search-match-repository.integration.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, pool } from '../../../db/client.js';
import { savedSearches, users, vigenteProcedures } from '../../../db/schema/index.js';
import { DrizzleSavedSearchMatchRepository } from './saved-search-match-repository.js';

const repo = new DrizzleSavedSearchMatchRepository(db);
let searchId: number;
let vigenteId: number;

beforeEach(async () => {
  const [user] = await db
    .insert(users)
    .values({ username: `__test_match_user_${Date.now()}_${Math.random()}`, passwordHash: 'x' })
    .returning();
  const [search] = await db
    .insert(savedSearches)
    .values({ userId: user!.id, name: '__test__', filters: {} })
    .returning();
  searchId = search!.id;

  const numero = `__TEST-MATCH-${Date.now()}-${Math.random()}`;
  const [vigente] = await db
    .insert(vigenteProcedures)
    .values({ numeroProcedimiento: numero, estatus: 'PUBLICADA' })
    .returning();
  vigenteId = vigente!.id;
});

afterAll(async () => {
  await pool.end();
});

describe('DrizzleSavedSearchMatchRepository', () => {
  it('findState returns null when the pair was never seen', async () => {
    expect(await repo.findState(searchId, vigenteId)).toBeNull();
  });

  it('createState then findState returns the baseline row', async () => {
    await repo.createState(searchId, vigenteId, 'PUBLICADA');
    const state = await repo.findState(searchId, vigenteId);
    expect(state).not.toBeNull();
    expect(state!.savedSearchId).toBe(searchId);
    expect(state!.vigenteId).toBe(vigenteId);
    expect(state!.lastEstatus).toBe('PUBLICADA');
    expect(state!.closingSoonNotifiedAt).toBeNull();
  });

  it('updateEstatus changes last_estatus without touching closing_soon_notified_at', async () => {
    await repo.createState(searchId, vigenteId, 'PUBLICADA');
    await repo.markClosingSoonNotified(searchId, vigenteId);
    await repo.updateEstatus(searchId, vigenteId, 'EN EVALUACIÓN');

    const state = await repo.findState(searchId, vigenteId);
    expect(state!.lastEstatus).toBe('EN EVALUACIÓN');
    expect(state!.closingSoonNotifiedAt).not.toBeNull();
  });

  it('markClosingSoonNotified sets a timestamp', async () => {
    await repo.createState(searchId, vigenteId, 'PUBLICADA');
    await repo.markClosingSoonNotified(searchId, vigenteId);
    const state = await repo.findState(searchId, vigenteId);
    expect(state!.closingSoonNotifiedAt).toBeInstanceOf(Date);
  });
});
```

- [ ] **Step 3: Verificar que falla**

```bash
cd apps/backend && pnpm exec vitest run src/infrastructure/db/repositories/saved-search-match-repository.integration.test.ts
```

Expected: FAIL — módulo no encontrado.

- [ ] **Step 4: Implementar `DrizzleSavedSearchMatchRepository`**

Crear `apps/backend/src/infrastructure/db/repositories/saved-search-match-repository.ts`:

```ts
import { eq, and } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../../db/schema/index.js';
import { savedSearchMatches } from '../../../db/schema/index.js';
import type {
  SavedSearchMatchRepository,
  SavedSearchMatchRecord,
} from '../../../domain/repositories/saved-search-match-repository.js';

type Db = NodePgDatabase<typeof schema>;

function toRecord(row: typeof savedSearchMatches.$inferSelect): SavedSearchMatchRecord {
  return {
    id: row.id,
    savedSearchId: row.savedSearchId,
    vigenteId: row.vigenteId,
    lastEstatus: row.lastEstatus,
    closingSoonNotifiedAt: row.closingSoonNotifiedAt,
    createdAt: row.createdAt,
  };
}

export class DrizzleSavedSearchMatchRepository implements SavedSearchMatchRepository {
  constructor(private readonly db: Db) {}

  async findState(savedSearchId: number, vigenteId: number): Promise<SavedSearchMatchRecord | null> {
    const [row] = await this.db
      .select()
      .from(savedSearchMatches)
      .where(and(eq(savedSearchMatches.savedSearchId, savedSearchId), eq(savedSearchMatches.vigenteId, vigenteId)))
      .limit(1);
    return row ? toRecord(row) : null;
  }

  async createState(savedSearchId: number, vigenteId: number, estatus: string | null): Promise<void> {
    await this.db.insert(savedSearchMatches).values({ savedSearchId, vigenteId, lastEstatus: estatus });
  }

  async updateEstatus(savedSearchId: number, vigenteId: number, estatus: string | null): Promise<void> {
    await this.db
      .update(savedSearchMatches)
      .set({ lastEstatus: estatus })
      .where(and(eq(savedSearchMatches.savedSearchId, savedSearchId), eq(savedSearchMatches.vigenteId, vigenteId)));
  }

  async markClosingSoonNotified(savedSearchId: number, vigenteId: number): Promise<void> {
    await this.db
      .update(savedSearchMatches)
      .set({ closingSoonNotifiedAt: new Date() })
      .where(and(eq(savedSearchMatches.savedSearchId, savedSearchId), eq(savedSearchMatches.vigenteId, vigenteId)));
  }
}
```

- [ ] **Step 5: Correr el test y confirmar que pasa**

```bash
cd apps/backend && pnpm exec vitest run src/infrastructure/db/repositories/saved-search-match-repository.integration.test.ts
```

Expected: 4/4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/domain/repositories/saved-search-match-repository.ts apps/backend/src/infrastructure/db/repositories/saved-search-match-repository.ts apps/backend/src/infrastructure/db/repositories/saved-search-match-repository.integration.test.ts
git commit -m "feat(alertas): agrega SavedSearchMatchRepository (dominio + Drizzle)"
```

---

## Task 4: `EmailSender` — Elastic Email + Null implementation

**Files:**
- Create: `apps/backend/src/domain/email/email-sender.ts`
- Create: `apps/backend/src/infrastructure/email/elastic-email-client.ts`
- Create: `apps/backend/src/infrastructure/email/null-email-sender.ts`
- Test: `apps/backend/src/infrastructure/email/elastic-email-client.test.ts`

**Interfaces:**
- Produces: `EmailSender`, `EmailMessage`, `ElasticEmailClient`, `NullEmailSender` — usados por Task 6 (EvaluateAlerts) y Task 9 (wiring).

- [ ] **Step 1: Escribir la interfaz de dominio**

Crear `apps/backend/src/domain/email/email-sender.ts`:

```ts
/** EmailSender — dominio port para el envío de correos (PR13). */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}
```

- [ ] **Step 2: Escribir el test del cliente (fallando)**

Crear `apps/backend/src/infrastructure/email/elastic-email-client.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ElasticEmailClient } from './elastic-email-client.js';

describe('ElasticEmailClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs a la API v4 de Elastic Email con el contenido del mensaje', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response('{}', { status: 200 });
    });

    const client = new ElasticEmailClient('test-api-key', 'alertas@tecnolicity.mx');
    await client.send({ to: 'user@example.com', subject: 'Asunto', text: 'texto', html: '<p>html</p>' });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.elasticemail.com/v4/emails');

    const init = calls[0]!.init;
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['X-ElasticEmail-ApiKey']).toBe('test-api-key');

    const body = JSON.parse(init.body as string) as {
      Recipients: { Email: string }[];
      Content: { From: string; Subject: string; Body: { ContentType: string; Content: string }[] };
    };
    expect(body.Recipients).toEqual([{ Email: 'user@example.com' }]);
    expect(body.Content.From).toBe('alertas@tecnolicity.mx');
    expect(body.Content.Subject).toBe('Asunto');
    expect(body.Content.Body).toEqual([
      { ContentType: 'HTML', Content: '<p>html</p>' },
      { ContentType: 'PlainText', Content: 'texto' },
    ]);
  });

  it('lanza un error cuando la API responde con un status no-2xx', async () => {
    vi.stubGlobal('fetch', async () => new Response('bad key', { status: 401 }));
    const client = new ElasticEmailClient('bad-key', 'alertas@tecnolicity.mx');
    await expect(
      client.send({ to: 'user@example.com', subject: 's', text: 't', html: '<p>h</p>' }),
    ).rejects.toThrow(/401/);
  });
});
```

- [ ] **Step 3: Verificar que falla**

```bash
cd apps/backend && pnpm exec vitest run src/infrastructure/email/elastic-email-client.test.ts
```

Expected: FAIL — módulo no encontrado.

- [ ] **Step 4: Implementar `ElasticEmailClient` y `NullEmailSender`**

Crear `apps/backend/src/infrastructure/email/elastic-email-client.ts`:

```ts
import type { EmailSender, EmailMessage } from '../../domain/email/email-sender.js';

const ELASTIC_EMAIL_API_URL = 'https://api.elasticemail.com/v4/emails';

/** Cliente delgado sobre la API HTTP v4 de Elastic Email (PR13). */
export class ElasticEmailClient implements EmailSender {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    const res = await fetch(ELASTIC_EMAIL_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-ElasticEmail-ApiKey': this.apiKey,
      },
      body: JSON.stringify({
        Recipients: [{ Email: message.to }],
        Content: {
          From: this.from,
          Subject: message.subject,
          Body: [
            { ContentType: 'HTML', Content: message.html },
            { ContentType: 'PlainText', Content: message.text },
          ],
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Elastic Email request failed: ${res.status} ${body}`);
    }
  }
}
```

Crear `apps/backend/src/infrastructure/email/null-email-sender.ts`:

```ts
import type { EmailSender, EmailMessage } from '../../domain/email/email-sender.js';

/**
 * Se usa cuando ELASTIC_EMAIL_API_KEY no está configurado (PR13). La
 * evaluación de alertas sigue corriendo normalmente — solo el envío se
 * reemplaza por un log, así ningún despliegue existente se rompe por no
 * tener el proveedor de correo configurado todavía.
 */
export class NullEmailSender implements EmailSender {
  async send(message: EmailMessage): Promise<void> {
    console.warn(
      `[alerts] ELASTIC_EMAIL_API_KEY no configurado — se habría enviado a ${message.to}: "${message.subject}"`,
    );
  }
}
```

- [ ] **Step 5: Correr el test y confirmar que pasa**

```bash
cd apps/backend && pnpm exec vitest run src/infrastructure/email/elastic-email-client.test.ts
```

Expected: 2/2 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/domain/email/ apps/backend/src/infrastructure/email/
git commit -m "feat(alertas): agrega EmailSender, ElasticEmailClient y NullEmailSender"
```

---

## Task 5: `digest-builder.ts` — formateo puro del correo

**Files:**
- Create: `apps/backend/src/application/alerts/digest-builder.ts`
- Test: `apps/backend/src/application/alerts/digest-builder.test.ts`

**Interfaces:**
- Consumes: `AlertEventType` (Task 3).
- Produces: `DigestEvent`, `Digest`, `buildDigest()` — usados por Task 6.

- [ ] **Step 1: Escribir el test (fallando)**

Crear `apps/backend/src/application/alerts/digest-builder.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildDigest, type DigestEvent } from './digest-builder.js';

function makeEvent(overrides: Partial<DigestEvent> = {}): DigestEvent {
  return {
    type: 'new_match',
    savedSearchName: 'Obra pública SICT',
    vigenteNombre: 'Construcción de carretera',
    numeroProcedimiento: 'AA-001-2026',
    dependencia: 'SICT',
    ...overrides,
  };
}

describe('buildDigest', () => {
  it('resume las cantidades por tipo en el subject', () => {
    const digest = buildDigest(
      [
        makeEvent({ type: 'new_match' }),
        makeEvent({ type: 'new_match' }),
        makeEvent({ type: 'closing_soon', fechaPresentacionApertura: new Date('2026-09-10') }),
      ],
      'https://tecnolicity.example',
    );
    expect(digest.subject).toContain('2 nueva(s)');
    expect(digest.subject).toContain('1 por cerrar');
    expect(digest.subject).not.toContain('cambio de estatus');
  });

  it('incluye un link directo al detalle de la vigente en texto y HTML', () => {
    const digest = buildDigest([makeEvent()], 'https://tecnolicity.example');
    expect(digest.text).toContain('https://tecnolicity.example/vigentes/AA-001-2026');
    expect(digest.html).toContain('https://tecnolicity.example/vigentes/AA-001-2026');
  });

  it('describe un evento status_change con los valores from/to', () => {
    const digest = buildDigest(
      [makeEvent({ type: 'status_change', fromEstatus: 'PUBLICADA', toEstatus: 'EN EVALUACIÓN' })],
      'https://tecnolicity.example',
    );
    expect(digest.text).toContain('PUBLICADA');
    expect(digest.text).toContain('EN EVALUACIÓN');
  });

  it('escapa caracteres HTML-inseguros en nombres de vigentes', () => {
    const digest = buildDigest(
      [makeEvent({ vigenteNombre: 'Compra de <equipo> & "accesorios"' })],
      'https://tecnolicity.example',
    );
    expect(digest.html).not.toContain('<equipo>');
    expect(digest.html).toContain('&lt;equipo&gt;');
  });

  it('quita la barra final de baseUrl al construir el link', () => {
    const digest = buildDigest([makeEvent()], 'https://tecnolicity.example/');
    expect(digest.text).toContain('https://tecnolicity.example/vigentes/AA-001-2026');
    expect(digest.text).not.toContain('example//vigentes');
  });
});
```

- [ ] **Step 2: Verificar que falla**

```bash
cd apps/backend && pnpm exec vitest run src/application/alerts/digest-builder.test.ts
```

Expected: FAIL — módulo no encontrado.

- [ ] **Step 3: Implementar `buildDigest`**

Crear `apps/backend/src/application/alerts/digest-builder.ts`:

```ts
import type { AlertEventType } from '../../domain/repositories/saved-search-match-repository.js';

export interface DigestEvent {
  type: AlertEventType;
  savedSearchName: string;
  vigenteNombre: string | null;
  numeroProcedimiento: string;
  dependencia: string | null;
  fromEstatus?: string | null;
  toEstatus?: string | null;
  fechaPresentacionApertura?: Date | null;
}

export interface Digest {
  subject: string;
  text: string;
  html: string;
}

function vigenteUrl(baseUrl: string, numeroProcedimiento: string): string {
  return `${baseUrl.replace(/\/$/, '')}/vigentes/${encodeURIComponent(numeroProcedimiento)}`;
}

function describeEvent(event: DigestEvent): string {
  const nombre = event.vigenteNombre ?? event.numeroProcedimiento;
  switch (event.type) {
    case 'new_match':
      return `Nueva coincidencia en "${event.savedSearchName}": ${nombre}${event.dependencia ? ` — ${event.dependencia}` : ''}`;
    case 'status_change':
      return `Cambio de estatus en "${event.savedSearchName}": ${nombre} pasó de "${event.fromEstatus ?? 'sin estatus'}" a "${event.toEstatus ?? 'sin estatus'}"`;
    case 'closing_soon':
      return `Cierre próximo en "${event.savedSearchName}": ${nombre} cierra el ${
        event.fechaPresentacionApertura?.toLocaleDateString('es-MX') ?? 'próximamente'
      }`;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Arma un digest (subject + texto plano + HTML simple) para un lote de eventos de un usuario. */
export function buildDigest(events: DigestEvent[], baseUrl: string): Digest {
  const counts: Record<AlertEventType, number> = { new_match: 0, closing_soon: 0, status_change: 0 };
  for (const e of events) counts[e.type] += 1;

  const subjectParts: string[] = [];
  if (counts.new_match > 0) subjectParts.push(`${counts.new_match} nueva(s)`);
  if (counts.closing_soon > 0) subjectParts.push(`${counts.closing_soon} por cerrar`);
  if (counts.status_change > 0) subjectParts.push(`${counts.status_change} con cambio de estatus`);
  const subject = `Tecnolicity — ${subjectParts.join(' · ')}`;

  const text = events
    .map((e) => `- ${describeEvent(e)}\n  ${vigenteUrl(baseUrl, e.numeroProcedimiento)}`)
    .join('\n\n');

  const htmlItems = events
    .map(
      (e) =>
        `<li>${escapeHtml(describeEvent(e))}<br/><a href="${vigenteUrl(baseUrl, e.numeroProcedimiento)}">Ver detalle</a></li>`,
    )
    .join('');
  const html = `<div><ul>${htmlItems}</ul></div>`;

  return { subject, text, html };
}
```

- [ ] **Step 4: Correr el test y confirmar que pasa**

```bash
cd apps/backend && pnpm exec vitest run src/application/alerts/digest-builder.test.ts
```

Expected: 5/5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/application/alerts/digest-builder.ts apps/backend/src/application/alerts/digest-builder.test.ts
git commit -m "feat(alertas): agrega digest-builder (formateo puro del correo)"
```

---

## Task 6: `EvaluateAlerts` — caso de uso central

**Files:**
- Modify: `apps/backend/src/domain/repositories/vigente-repository.ts` (agrega `createdAt` a `VigenteRecord`)
- Modify: `apps/backend/src/infrastructure/db/repositories/vigente-repository.ts` (`toRecord` incluye `createdAt`)
- Modify: `apps/backend/src/domain/repositories/user-repository.ts` (agrega `email` a `UserRecord`/`CreateUserInput`/`UpdateUserInput`, agrega `findById`)
- Modify: `apps/backend/src/infrastructure/db/repositories/user-repository.ts` (implementa `email` + `findById`)
- Create: `apps/backend/src/application/alerts/evaluate-alerts.ts`
- Test: `apps/backend/src/application/alerts/evaluate-alerts.test.ts`

**Interfaces:**
- Consumes: `SavedSearchRepository` (Task 2), `SavedSearchMatchRepository` (Task 3), `EmailSender`/`buildDigest` (Tasks 4-5), `VigenteRepository` (existente, modificado aquí), `UserRepository` (existente, modificado aquí).
- Produces: `EvaluateAlerts`, `EvaluateAlertsDeps`, `EvaluateAlertsSummary` — usado por Task 9 (wiring en `server.ts`/`vigente-cron.ts`).

- [ ] **Step 1: Agregar `createdAt` a `VigenteRecord`**

Editar `apps/backend/src/domain/repositories/vigente-repository.ts`, en la interfaz `VigenteRecord` agregar el campo (después de `scrapedAt`):

```ts
export interface VigenteRecord {
  id: number;
  numeroProcedimiento: string;
  nombre: string | null;
  caracter: string | null;
  dependencia: string | null;
  siglasDependencia: string | null;
  estatus: string | null;
  fechaJuntaAclaraciones: Date | null;
  fechaPresentacionApertura: Date | null;
  tipoProcedimiento: string | null;
  tipoContratacion: string | null;
  unidadCompradora: string | null;
  codigoExpediente: string | null;
  uuidProcedimiento: string | null;
  direccionesAnuncio: string | null;
  entidadFederativa: string | null;
  scrapedAt: Date;
  /** Cuándo se vio esta vigente por primera vez (PR13: detecta "nueva"). */
  createdAt: Date;
}
```

Editar `apps/backend/src/infrastructure/db/repositories/vigente-repository.ts`, en `toRecord()` agregar la última línea:

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
  };
}
```

- [ ] **Step 2: Agregar `email` y `findById` a `UserRepository`**

Editar `apps/backend/src/domain/repositories/user-repository.ts`:

```ts
export interface UserRecord {
  id: number;
  username: string;
  passwordHash: string;
  email: string | null;
  active: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export interface CreateUserInput {
  username: string;
  passwordHash: string;
  email?: string | null;
}

export interface UpdateUserInput {
  active?: boolean;
  passwordHash?: string;
  email?: string | null;
}

export interface UserRepository {
  count(): Promise<number>;
  list(): Promise<UserRecord[]>;
  findByUsername(username: string): Promise<UserRecord | null>;
  findById(id: number): Promise<UserRecord | null>;
  create(input: CreateUserInput): Promise<UserRecord>;
  update(id: number, patch: UpdateUserInput): Promise<UserRecord | null>;
  delete(id: number): Promise<boolean>;
  touchLastLogin(id: number): Promise<void>;
  countOtherActive(excludeId: number): Promise<number>;
}
```

Editar `apps/backend/src/infrastructure/db/repositories/user-repository.ts`:

```ts
import { eq, ne, and, count, desc } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../../db/schema/index.js';
import { users } from '../../../db/schema/index.js';
import type {
  UserRepository,
  UserRecord,
  CreateUserInput,
  UpdateUserInput,
} from '../../../domain/repositories/user-repository.js';

type Db = NodePgDatabase<typeof schema>;

function toRecord(row: typeof users.$inferSelect): UserRecord {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.passwordHash,
    email: row.email,
    active: row.active,
    lastLoginAt: row.lastLoginAt,
    createdAt: row.createdAt,
  };
}

export class DrizzleUserRepository implements UserRepository {
  constructor(private readonly db: Db) {}

  async count(): Promise<number> {
    const [row] = await this.db.select({ n: count() }).from(users);
    return row?.n ?? 0;
  }

  async list(): Promise<UserRecord[]> {
    const rows = await this.db.select().from(users).orderBy(desc(users.createdAt));
    return rows.map(toRecord);
  }

  async findByUsername(username: string): Promise<UserRecord | null> {
    const [row] = await this.db.select().from(users).where(eq(users.username, username)).limit(1);
    return row ? toRecord(row) : null;
  }

  async findById(id: number): Promise<UserRecord | null> {
    const [row] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return row ? toRecord(row) : null;
  }

  async create(input: CreateUserInput): Promise<UserRecord> {
    const [row] = await this.db
      .insert(users)
      .values({ username: input.username, passwordHash: input.passwordHash, email: input.email ?? null })
      .returning();
    return toRecord(row!);
  }

  async update(id: number, patch: UpdateUserInput): Promise<UserRecord | null> {
    const [row] = await this.db
      .update(users)
      .set({
        ...(patch.active !== undefined ? { active: patch.active } : {}),
        ...(patch.passwordHash !== undefined ? { passwordHash: patch.passwordHash } : {}),
        ...(patch.email !== undefined ? { email: patch.email } : {}),
      })
      .where(eq(users.id, id))
      .returning();
    return row ? toRecord(row) : null;
  }

  async delete(id: number): Promise<boolean> {
    const rows = await this.db.delete(users).where(eq(users.id, id)).returning({ id: users.id });
    return rows.length > 0;
  }

  async touchLastLogin(id: number): Promise<void> {
    await this.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, id));
  }

  async countOtherActive(excludeId: number): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(users)
      .where(and(ne(users.id, excludeId), eq(users.active, true)));
    return row?.n ?? 0;
  }
}
```

- [ ] **Step 3: Correr el typecheck para confirmar que estos dos cambios no rompen nada existente**

```bash
cd apps/backend && pnpm exec tsc --noEmit
```

Expected: sin errores (los otros call sites de `UserRepository.create`/`update` no pasan `email`, que es opcional).

- [ ] **Step 4: Escribir el test de `EvaluateAlerts` (fallando)**

Crear `apps/backend/src/application/alerts/evaluate-alerts.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { EvaluateAlerts } from './evaluate-alerts.js';
import type {
  SavedSearchRepository,
  SavedSearchRecord,
  CreateSavedSearchInput,
  UpdateSavedSearchInput,
} from '../../domain/repositories/saved-search-repository.js';
import type {
  SavedSearchMatchRepository,
  SavedSearchMatchRecord,
} from '../../domain/repositories/saved-search-match-repository.js';
import type {
  VigenteRepository,
  VigenteRecord,
  VigenteFilter,
  VigentePage,
  UpsertVigenteInput,
  VigenteDetalleCache,
} from '../../domain/repositories/vigente-repository.js';
import type {
  UserRepository,
  UserRecord,
  CreateUserInput,
  UpdateUserInput,
} from '../../domain/repositories/user-repository.js';
import type { EmailSender, EmailMessage } from '../../domain/email/email-sender.js';

// --- Fakes -------------------------------------------------------------

class FakeSavedSearchRepository implements SavedSearchRepository {
  rows: SavedSearchRecord[] = [];
  async listByUser(userId: number) {
    return this.rows.filter((r) => r.userId === userId);
  }
  async listActive() {
    return this.rows.filter((r) => r.active);
  }
  async findById(id: number) {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async create(input: CreateSavedSearchInput) {
    const row: SavedSearchRecord = {
      id: this.rows.length + 1,
      userId: input.userId,
      name: input.name,
      filters: input.filters,
      active: true,
      createdAt: new Date(),
    };
    this.rows.push(row);
    return row;
  }
  async update(id: number, patch: UpdateSavedSearchInput) {
    const row = this.rows.find((r) => r.id === id);
    if (!row) return null;
    Object.assign(row, patch);
    return row;
  }
  async delete(id: number) {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => r.id !== id);
    return this.rows.length < before;
  }
}

class FakeSavedSearchMatchRepository implements SavedSearchMatchRepository {
  rows: SavedSearchMatchRecord[] = [];
  private nextId = 1;
  async findState(savedSearchId: number, vigenteId: number) {
    return this.rows.find((r) => r.savedSearchId === savedSearchId && r.vigenteId === vigenteId) ?? null;
  }
  async createState(savedSearchId: number, vigenteId: number, estatus: string | null) {
    this.rows.push({
      id: this.nextId++,
      savedSearchId,
      vigenteId,
      lastEstatus: estatus,
      closingSoonNotifiedAt: null,
      createdAt: new Date(),
    });
  }
  async updateEstatus(savedSearchId: number, vigenteId: number, estatus: string | null) {
    const row = this.rows.find((r) => r.savedSearchId === savedSearchId && r.vigenteId === vigenteId);
    if (row) row.lastEstatus = estatus;
  }
  async markClosingSoonNotified(savedSearchId: number, vigenteId: number) {
    const row = this.rows.find((r) => r.savedSearchId === savedSearchId && r.vigenteId === vigenteId);
    if (row) row.closingSoonNotifiedAt = new Date();
  }
}

class FakeVigenteRepository implements VigenteRepository {
  rows: VigenteRecord[] = [];
  async upsertMany(_rows: UpsertVigenteInput[]) {
    return { inserted: 0, updated: 0 };
  }
  async list(filter: VigenteFilter, page: number, pageSize: number): Promise<VigentePage> {
    const matches = this.rows.filter((r) => {
      if (filter.tipoContratacion && r.tipoContratacion !== filter.tipoContratacion) return false;
      if (filter.tipoProcedimiento && r.tipoProcedimiento !== filter.tipoProcedimiento) return false;
      if (filter.siglas && r.siglasDependencia !== filter.siglas) return false;
      if (filter.entidadFederativa && r.entidadFederativa !== filter.entidadFederativa) return false;
      if (filter.dependencia && !(r.dependencia ?? '').includes(filter.dependencia)) return false;
      if (filter.q && !(r.nombre ?? '').toLowerCase().includes(filter.q.toLowerCase())) return false;
      return true;
    });
    return { data: matches, pagination: { page, page_size: pageSize, total: matches.length, total_pages: 1 } };
  }
  async getByNumero(numero: string) {
    return this.rows.find((r) => r.numeroProcedimiento === numero) ?? null;
  }
  async count() {
    return this.rows.length;
  }
  async getDetalle(): Promise<VigenteDetalleCache | null> {
    return null;
  }
  async updateDetalle() {}
}

class FakeUserRepository implements UserRepository {
  rows: UserRecord[] = [];
  async count() {
    return this.rows.length;
  }
  async list() {
    return this.rows;
  }
  async findByUsername(username: string) {
    return this.rows.find((r) => r.username === username) ?? null;
  }
  async findById(id: number) {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async create(input: CreateUserInput) {
    const row: UserRecord = {
      id: this.rows.length + 1,
      username: input.username,
      passwordHash: input.passwordHash,
      email: input.email ?? null,
      active: true,
      lastLoginAt: null,
      createdAt: new Date(),
    };
    this.rows.push(row);
    return row;
  }
  async update(id: number, patch: UpdateUserInput) {
    const row = this.rows.find((r) => r.id === id);
    if (!row) return null;
    Object.assign(row, patch);
    return row;
  }
  async delete(id: number) {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => r.id !== id);
    return this.rows.length < before;
  }
  async touchLastLogin() {}
  async countOtherActive(excludeId: number) {
    return this.rows.filter((r) => r.id !== excludeId && r.active).length;
  }
}

class FakeEmailSender implements EmailSender {
  sent: EmailMessage[] = [];
  shouldFail = false;
  async send(message: EmailMessage) {
    if (this.shouldFail) throw new Error('send failed');
    this.sent.push(message);
  }
}

function makeVigente(overrides: Partial<VigenteRecord> = {}): VigenteRecord {
  return {
    id: 1,
    numeroProcedimiento: 'AA-001-2026',
    nombre: 'Construcción de carretera',
    caracter: null,
    dependencia: 'SICT',
    siglasDependencia: 'SICT',
    estatus: 'PUBLICADA',
    fechaJuntaAclaraciones: null,
    fechaPresentacionApertura: null,
    tipoProcedimiento: null,
    tipoContratacion: null,
    unidadCompradora: null,
    codigoExpediente: null,
    uuidProcedimiento: null,
    direccionesAnuncio: null,
    entidadFederativa: null,
    scrapedAt: new Date(),
    createdAt: new Date(),
    ...overrides,
  };
}

function makeDeps() {
  const savedSearches = new FakeSavedSearchRepository();
  const matches = new FakeSavedSearchMatchRepository();
  const vigentes = new FakeVigenteRepository();
  const users = new FakeUserRepository();
  const email = new FakeEmailSender();
  const usecase = new EvaluateAlerts({ savedSearches, matches, vigentes, users, email, baseUrl: 'https://tecnolicity.example' });
  return { usecase, savedSearches, matches, vigentes, users, email };
}

// --- Tests ---------------------------------------------------------------

describe('EvaluateAlerts', () => {
  it('new_match: vigente fresca de esta corrida que matchea → un evento, se manda correo, se crea el estado', async () => {
    const { usecase, savedSearches, vigentes, users, email, matches } = makeDeps();
    const user = await users.create({ username: 'ana', passwordHash: 'x', email: 'ana@example.com' });
    const search = await savedSearches.create({ userId: user.id, name: 'Obra SICT', filters: { siglas: 'SICT' } });
    const runStart = new Date('2026-09-01T06:00:00Z');
    vigentes.rows.push(makeVigente({ id: 1, createdAt: new Date('2026-09-01T06:05:00Z') }));

    const summary = await usecase.execute(runStart);

    expect(summary.eventsDetected).toBe(1);
    expect(summary.usersNotified).toBe(1);
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]!.to).toBe('ana@example.com');
    expect(email.sent[0]!.subject).toContain('1 nueva(s)');
    const state = await matches.findState(search.id, 1);
    expect(state?.lastEstatus).toBe('PUBLICADA');
  });

  it('línea base silenciosa: vigente vieja que matchea una búsqueda nueva → sin correo, pero se crea el estado', async () => {
    const { usecase, savedSearches, vigentes, users, email, matches } = makeDeps();
    const user = await users.create({ username: 'ana', passwordHash: 'x', email: 'ana@example.com' });
    const search = await savedSearches.create({ userId: user.id, name: 'Obra SICT', filters: { siglas: 'SICT' } });
    const runStart = new Date('2026-09-01T06:00:00Z');
    vigentes.rows.push(makeVigente({ id: 1, createdAt: new Date('2026-01-01T00:00:00Z') }));

    const summary = await usecase.execute(runStart);

    expect(summary.eventsDetected).toBe(0);
    expect(email.sent).toHaveLength(0);
    const state = await matches.findState(search.id, 1);
    expect(state).not.toBeNull(); // línea base creada igual, para no re-evaluarla como "nueva" mañana
  });

  it('status_change: vigente ya conocida cambia de estatus → evento, correo, se actualiza el estado tras el envío', async () => {
    const { usecase, savedSearches, vigentes, users, email, matches } = makeDeps();
    const user = await users.create({ username: 'ana', passwordHash: 'x', email: 'ana@example.com' });
    const search = await savedSearches.create({ userId: user.id, name: 'Obra SICT', filters: { siglas: 'SICT' } });
    await matches.createState(search.id, 1, 'PUBLICADA');
    vigentes.rows.push(makeVigente({ id: 1, estatus: 'EN EVALUACIÓN' }));

    const summary = await usecase.execute(new Date());

    expect(summary.eventsDetected).toBe(1);
    expect(email.sent[0]!.text).toContain('PUBLICADA');
    expect(email.sent[0]!.text).toContain('EN EVALUACIÓN');
    const state = await matches.findState(search.id, 1);
    expect(state?.lastEstatus).toBe('EN EVALUACIÓN');
  });

  it('closing_soon: vigente cierra en 2 días y nunca se avisó → evento, correo, se marca como notificada', async () => {
    const { usecase, savedSearches, vigentes, users, email, matches } = makeDeps();
    const user = await users.create({ username: 'ana', passwordHash: 'x', email: 'ana@example.com' });
    const search = await savedSearches.create({ userId: user.id, name: 'Obra SICT', filters: { siglas: 'SICT' } });
    const now = new Date('2026-09-01T12:00:00Z');
    await matches.createState(search.id, 1, 'PUBLICADA');
    vigentes.rows.push(
      makeVigente({ id: 1, fechaPresentacionApertura: new Date('2026-09-03T12:00:00Z') }),
    );

    const summary = await usecase.execute(now, now);

    expect(summary.eventsDetected).toBe(1);
    const state = await matches.findState(search.id, 1);
    expect(state?.closingSoonNotifiedAt).not.toBeNull();
  });

  it('closing_soon: no se repite si ya se había notificado', async () => {
    const { usecase, savedSearches, vigentes, users, email, matches } = makeDeps();
    const user = await users.create({ username: 'ana', passwordHash: 'x', email: 'ana@example.com' });
    const search = await savedSearches.create({ userId: user.id, name: 'Obra SICT', filters: { siglas: 'SICT' } });
    const now = new Date('2026-09-01T12:00:00Z');
    await matches.createState(search.id, 1, 'PUBLICADA');
    await matches.markClosingSoonNotified(search.id, 1);
    vigentes.rows.push(
      makeVigente({ id: 1, fechaPresentacionApertura: new Date('2026-09-03T12:00:00Z') }),
    );

    const summary = await usecase.execute(now, now);

    expect(summary.eventsDetected).toBe(0);
    expect(email.sent).toHaveLength(0);
  });

  it('búsquedas inactivas no se evalúan', async () => {
    const { usecase, savedSearches, vigentes, users, email } = makeDeps();
    const user = await users.create({ username: 'ana', passwordHash: 'x', email: 'ana@example.com' });
    const search = await savedSearches.create({ userId: user.id, name: 'Obra SICT', filters: { siglas: 'SICT' } });
    await savedSearches.update(search.id, { active: false });
    vigentes.rows.push(makeVigente({ id: 1, createdAt: new Date() }));

    const summary = await usecase.execute(new Date(0));

    expect(summary.searchesEvaluated).toBe(0);
    expect(email.sent).toHaveLength(0);
  });

  it('usuario sin email: no se manda correo y el estado NO se persiste (reintenta al día siguiente)', async () => {
    const { usecase, savedSearches, vigentes, users, email, matches } = makeDeps();
    const user = await users.create({ username: 'ana', passwordHash: 'x', email: null });
    const search = await savedSearches.create({ userId: user.id, name: 'Obra SICT', filters: { siglas: 'SICT' } });
    const runStart = new Date('2026-09-01T06:00:00Z');
    vigentes.rows.push(makeVigente({ id: 1, createdAt: new Date('2026-09-01T06:05:00Z') }));

    const summary = await usecase.execute(runStart);

    expect(summary.eventsDetected).toBe(1);
    expect(summary.usersNotified).toBe(0);
    expect(email.sent).toHaveLength(0);
    expect(await matches.findState(search.id, 1)).toBeNull();
  });

  it('fallo de envío: no se persiste el estado y no frena la evaluación de otros usuarios', async () => {
    const { usecase, savedSearches, vigentes, users, email, matches } = makeDeps();
    const failingUser = await users.create({ username: 'ana', passwordHash: 'x', email: 'ana@example.com' });
    const okUser = await users.create({ username: 'beto', passwordHash: 'x', email: 'beto@example.com' });
    const searchA = await savedSearches.create({ userId: failingUser.id, name: 'Búsqueda A', filters: { siglas: 'SICT' } });
    const searchB = await savedSearches.create({ userId: okUser.id, name: 'Búsqueda B', filters: { siglas: 'IMSS' } });
    const runStart = new Date('2026-09-01T06:00:00Z');
    vigentes.rows.push(
      makeVigente({ id: 1, siglasDependencia: 'SICT', createdAt: new Date('2026-09-01T06:05:00Z') }),
      makeVigente({ id: 2, numeroProcedimiento: 'BB-002-2026', siglasDependencia: 'IMSS', createdAt: new Date('2026-09-01T06:05:00Z') }),
    );
    email.shouldFail = true;

    const summary = await usecase.execute(runStart);
    expect(summary.usersNotified).toBe(0);
    expect(await matches.findState(searchA.id, 1)).toBeNull();
    expect(await matches.findState(searchB.id, 2)).toBeNull();

    email.shouldFail = false;
    const secondSummary = await usecase.execute(runStart);
    expect(secondSummary.usersNotified).toBe(2);
  });

  it('agrupa varios eventos del mismo usuario en un solo correo (digest)', async () => {
    const { usecase, savedSearches, vigentes, users, email } = makeDeps();
    const user = await users.create({ username: 'ana', passwordHash: 'x', email: 'ana@example.com' });
    await savedSearches.create({ userId: user.id, name: 'Búsqueda A', filters: { siglas: 'SICT' } });
    await savedSearches.create({ userId: user.id, name: 'Búsqueda B', filters: { siglas: 'IMSS' } });
    const runStart = new Date('2026-09-01T06:00:00Z');
    vigentes.rows.push(
      makeVigente({ id: 1, siglasDependencia: 'SICT', createdAt: new Date('2026-09-01T06:05:00Z') }),
      makeVigente({ id: 2, numeroProcedimiento: 'BB-002-2026', siglasDependencia: 'IMSS', createdAt: new Date('2026-09-01T06:05:00Z') }),
    );

    const summary = await usecase.execute(runStart);

    expect(summary.eventsDetected).toBe(2);
    expect(email.sent).toHaveLength(1); // un solo correo, no dos
    expect(email.sent[0]!.subject).toContain('2 nueva(s)');
  });
});
```

Nota sobre la firma de `execute`: el test de `closing_soon` llama `usecase.execute(runStart, now)` con dos argumentos — el segundo (`now`) es el momento de referencia para la ventana de 3 días, inyectable para que el test sea determinista sin mockear `Date`. Cuando se omite, por defecto es `new Date()`.

- [ ] **Step 5: Verificar que falla**

```bash
cd apps/backend && pnpm exec vitest run src/application/alerts/evaluate-alerts.test.ts
```

Expected: FAIL — módulo no encontrado.

- [ ] **Step 6: Implementar `EvaluateAlerts`**

Crear `apps/backend/src/application/alerts/evaluate-alerts.ts`:

```ts
import type { SavedSearchRepository, SavedSearchRecord } from '../../domain/repositories/saved-search-repository.js';
import type { SavedSearchMatchRepository } from '../../domain/repositories/saved-search-match-repository.js';
import type { VigenteRepository, VigenteRecord } from '../../domain/repositories/vigente-repository.js';
import type { UserRepository } from '../../domain/repositories/user-repository.js';
import type { EmailSender } from '../../domain/email/email-sender.js';
import { buildDigest, type DigestEvent } from './digest-builder.js';

/** Ventana de "cierre próximo" — fija en 3 días (ver spec). */
const CLOSING_SOON_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
/** Cap generoso: la tabla vigente_procedures tiene ~1-2k filas (ver vigente-repository.ts). */
const MAX_VIGENTES_PER_SEARCH = 5000;

export interface EvaluateAlertsDeps {
  savedSearches: SavedSearchRepository;
  matches: SavedSearchMatchRepository;
  vigentes: VigenteRepository;
  users: UserRepository;
  email: EmailSender;
  /** Origen público del frontend, para construir los links del correo (env.CORS_ORIGIN). */
  baseUrl: string;
}

export interface EvaluateAlertsSummary {
  searchesEvaluated: number;
  usersNotified: number;
  eventsDetected: number;
}

interface PendingEvent {
  event: DigestEvent;
  persist: () => Promise<void>;
}

/**
 * Caso de uso central de alertas (PR13). Se dispara pegado al cron diario del
 * scraper de vigentes — ver infrastructure/scheduler/vigente-cron.ts.
 *
 * Para cada búsqueda guardada activa, matchea contra `vigente_procedures`
 * (reusando VigenteRepository.list, sin paginar) y detecta 3 tipos de
 * eventos: new_match, status_change, closing_soon. Los eventos de un mismo
 * usuario se agrupan en un solo correo digest. La persistencia del "ya
 * notificado" ocurre SOLO después de un envío exitoso, para que un fallo de
 * red se reintente automáticamente en la corrida del día siguiente.
 */
export class EvaluateAlerts {
  constructor(private readonly deps: EvaluateAlertsDeps) {}

  async execute(scrapeRunStartedAt: Date, now: Date = new Date()): Promise<EvaluateAlertsSummary> {
    const searches = await this.deps.savedSearches.listActive();
    const eventsByUser = new Map<number, PendingEvent[]>();
    let eventsDetected = 0;

    for (const search of searches) {
      const filters = search.filters;
      const page = await this.deps.vigentes.list(
        {
          tipoContratacion: filters.tipoContratacion,
          tipoProcedimiento: filters.tipoProcedimiento,
          dependencia: filters.dependencia,
          siglas: filters.siglas,
          entidadFederativa: filters.entidadFederativa,
          q: filters.q,
        },
        1,
        MAX_VIGENTES_PER_SEARCH,
      );

      for (const vigente of page.data) {
        const pending = await this.evaluateOne(search, vigente, scrapeRunStartedAt, now);
        if (pending.length === 0) continue;
        eventsDetected += pending.length;
        const list = eventsByUser.get(search.userId) ?? [];
        list.push(...pending);
        eventsByUser.set(search.userId, list);
      }
    }

    let usersNotified = 0;
    for (const [userId, pending] of eventsByUser) {
      const sent = await this.notifyUser(userId, pending);
      if (sent) usersNotified += 1;
    }

    return { searchesEvaluated: searches.length, usersNotified, eventsDetected };
  }

  private async evaluateOne(
    search: SavedSearchRecord,
    vigente: VigenteRecord,
    scrapeRunStartedAt: Date,
    now: Date,
  ): Promise<PendingEvent[]> {
    const pending: PendingEvent[] = [];
    const state = await this.deps.matches.findState(search.id, vigente.id);
    let closingSoonAlreadyNotified = state?.closingSoonNotifiedAt != null;

    if (!state) {
      const isFreshFromThisRun = vigente.createdAt.getTime() >= scrapeRunStartedAt.getTime();
      if (isFreshFromThisRun) {
        pending.push({
          event: {
            type: 'new_match',
            savedSearchName: search.name,
            vigenteNombre: vigente.nombre,
            numeroProcedimiento: vigente.numeroProcedimiento,
            dependencia: vigente.dependencia,
          },
          persist: () => this.deps.matches.createState(search.id, vigente.id, vigente.estatus),
        });
      } else {
        // Línea base silenciosa: no hay correo pendiente para esto, así que
        // se persiste de inmediato (no depende de ningún envío exitoso).
        await this.deps.matches.createState(search.id, vigente.id, vigente.estatus);
      }
      closingSoonAlreadyNotified = false;
    } else if (state.lastEstatus !== vigente.estatus) {
      pending.push({
        event: {
          type: 'status_change',
          savedSearchName: search.name,
          vigenteNombre: vigente.nombre,
          numeroProcedimiento: vigente.numeroProcedimiento,
          dependencia: vigente.dependencia,
          fromEstatus: state.lastEstatus,
          toEstatus: vigente.estatus,
        },
        persist: () => this.deps.matches.updateEstatus(search.id, vigente.id, vigente.estatus),
      });
    }

    const closesAt = vigente.fechaPresentacionApertura;
    if (
      closesAt &&
      closesAt.getTime() > now.getTime() &&
      closesAt.getTime() - now.getTime() <= CLOSING_SOON_WINDOW_MS &&
      !closingSoonAlreadyNotified
    ) {
      pending.push({
        event: {
          type: 'closing_soon',
          savedSearchName: search.name,
          vigenteNombre: vigente.nombre,
          numeroProcedimiento: vigente.numeroProcedimiento,
          dependencia: vigente.dependencia,
          fechaPresentacionApertura: closesAt,
        },
        persist: () => this.deps.matches.markClosingSoonNotified(search.id, vigente.id),
      });
    }

    return pending;
  }

  /** Manda el digest y, solo si tuvo éxito, corre los `persist()` en orden (createState debe correr antes que markClosingSoonNotified para el mismo par). */
  private async notifyUser(userId: number, pending: PendingEvent[]): Promise<boolean> {
    try {
      const user = await this.deps.users.findById(userId);
      if (!user?.email) {
        console.warn(`[alerts] usuario ${userId} tiene ${pending.length} evento(s) pendiente(s) pero no tiene email configurado — se omite`);
        return false;
      }

      const digest = buildDigest(pending.map((p) => p.event), this.deps.baseUrl);
      await this.deps.email.send({ to: user.email, subject: digest.subject, text: digest.text, html: digest.html });

      for (const p of pending) {
        await p.persist();
      }
      return true;
    } catch (err) {
      console.error(`[alerts] no se pudo notificar al usuario ${userId}:`, err);
      return false;
    }
  }
}
```

- [ ] **Step 7: Correr el test y confirmar que pasa**

```bash
cd apps/backend && pnpm exec vitest run src/application/alerts/evaluate-alerts.test.ts
```

Expected: 9/9 tests PASS.

- [ ] **Step 8: Correr la suite completa + typecheck**

```bash
cd apps/backend && pnpm exec tsc --noEmit && pnpm test
```

Expected: typecheck limpio, todos los tests pasan (existentes + nuevos).

- [ ] **Step 9: Commit**

```bash
git add apps/backend/src/domain/repositories/vigente-repository.ts apps/backend/src/infrastructure/db/repositories/vigente-repository.ts apps/backend/src/domain/repositories/user-repository.ts apps/backend/src/infrastructure/db/repositories/user-repository.ts apps/backend/src/application/alerts/evaluate-alerts.ts apps/backend/src/application/alerts/evaluate-alerts.test.ts
git commit -m "feat(alertas): agrega EvaluateAlerts (caso de uso central)"
```

---

## Task 7: Router `admin-saved-searches`

**Files:**
- Create: `apps/backend/src/presentation/routes/admin-saved-searches.ts`
- Test: `apps/backend/src/presentation/admin-saved-searches.integration.test.ts`

**Interfaces:**
- Consumes: `SavedSearchRepository` (Task 2), `UserRepository` (Task 6), `createRequireAdmin`/`getCurrentUser` de `presentation/middleware/require-admin.ts` (existente).
- Produces: `createAdminSavedSearchesRouter(deps)` — usado por Task 9 (`server.ts`).

- [ ] **Step 1: Escribir el test de integración (fallando)**

Crear `apps/backend/src/presentation/admin-saved-searches.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { eq } from 'drizzle-orm';
import { createApp } from './server.js';
import { pool, db } from '../db/client.js';
import { users } from '../db/schema/index.js';
import { hashPassword } from '../infrastructure/auth/password.js';

const app = createApp();
const server = http.createServer(app);
let baseUrl = '';
let cookieA = '';
let cookieB = '';

async function login(username: string, password: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) throw new Error(`login failed for ${username}: ${res.status}`);
  return setCookie.split(';')[0]!;
}

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });

  const passwordHash = await hashPassword('__test_password_123__');
  await db.insert(users).values([
    { username: '__test_saved_search_user_a__', passwordHash, active: true },
    { username: '__test_saved_search_user_b__', passwordHash, active: true },
  ]);
  cookieA = await login('__test_saved_search_user_a__', '__test_password_123__');
  cookieB = await login('__test_saved_search_user_b__', '__test_password_123__');
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.delete(users).where(eq(users.username, '__test_saved_search_user_a__'));
  await db.delete(users).where(eq(users.username, '__test_saved_search_user_b__'));
  await pool.end();
});

describe('admin-saved-searches (HTTP integration)', () => {
  it('crea, lista, actualiza y elimina una búsqueda guardada', async () => {
    const createRes = await fetch(`${baseUrl}/api/admin/saved-searches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieA },
      body: JSON.stringify({ name: 'Obra SICT', filters: { siglas: 'SICT', q: 'carretera' } }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: number; name: string; filters: Record<string, unknown>; active: boolean };
    expect(created.name).toBe('Obra SICT');
    expect(created.filters.siglas).toBe('SICT');
    expect(created.active).toBe(true);

    const listRes = await fetch(`${baseUrl}/api/admin/saved-searches`, { headers: { Cookie: cookieA } });
    const list = (await listRes.json()) as { data: { id: number }[] };
    expect(list.data.some((s) => s.id === created.id)).toBe(true);

    const patchRes = await fetch(`${baseUrl}/api/admin/saved-searches/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookieA },
      body: JSON.stringify({ active: false }),
    });
    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json()) as { active: boolean };
    expect(patched.active).toBe(false);

    const deleteRes = await fetch(`${baseUrl}/api/admin/saved-searches/${created.id}`, {
      method: 'DELETE',
      headers: { Cookie: cookieA },
    });
    expect(deleteRes.status).toBe(204);
  });

  it('un usuario no puede ver, editar ni eliminar las búsquedas de otro (404)', async () => {
    const createRes = await fetch(`${baseUrl}/api/admin/saved-searches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieA },
      body: JSON.stringify({ name: 'Privada de A', filters: {} }),
    });
    const created = (await createRes.json()) as { id: number };

    const listAsB = await fetch(`${baseUrl}/api/admin/saved-searches`, { headers: { Cookie: cookieB } });
    const listB = (await listAsB.json()) as { data: { id: number }[] };
    expect(listB.data.some((s) => s.id === created.id)).toBe(false);

    const patchAsB = await fetch(`${baseUrl}/api/admin/saved-searches/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookieB },
      body: JSON.stringify({ active: false }),
    });
    expect(patchAsB.status).toBe(404);

    const deleteAsB = await fetch(`${baseUrl}/api/admin/saved-searches/${created.id}`, {
      method: 'DELETE',
      headers: { Cookie: cookieB },
    });
    expect(deleteAsB.status).toBe(404);
  });

  it('rechaza requests sin sesión con 401', async () => {
    const res = await fetch(`${baseUrl}/api/admin/saved-searches`);
    expect(res.status).toBe(401);
  });

  it('valida el body con 400 cuando falta el nombre', async () => {
    const res = await fetch(`${baseUrl}/api/admin/saved-searches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieA },
      body: JSON.stringify({ filters: {} }),
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Verificar que falla**

```bash
docker compose -f docker-compose.yml up -d && sleep 3 && cd apps/backend && pnpm db:migrate
pnpm exec vitest run src/presentation/admin-saved-searches.integration.test.ts
```

Expected: FAIL — `createApp()` no monta esa ruta todavía (o el módulo del router no existe).

- [ ] **Step 3: Implementar el router**

Crear `apps/backend/src/presentation/routes/admin-saved-searches.ts`:

```ts
import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import type { SavedSearchRepository, SavedSearchRecord } from '../../domain/repositories/saved-search-repository.js';
import type { UserRepository } from '../../domain/repositories/user-repository.js';
import { createRequireAdmin, getCurrentUser } from '../middleware/require-admin.js';

const filtersSchema = z.object({
  tipo_contratacion: z.string().trim().min(1).optional(),
  tipo_procedimiento: z.string().trim().min(1).optional(),
  dependencia: z.string().trim().min(1).optional(),
  siglas: z.string().trim().min(1).optional(),
  entidad_federativa: z.string().trim().min(1).optional(),
  q: z.string().trim().min(1).optional(),
});

const createBody = z.object({
  name: z.string().trim().min(1, 'name is required'),
  filters: filtersSchema,
});

const updateBody = z.object({
  name: z.string().trim().min(1).optional(),
  filters: filtersSchema.optional(),
  active: z.boolean().optional(),
});

function toDomainFilters(body: z.infer<typeof filtersSchema>): SavedSearchRecord['filters'] {
  return {
    ...(body.tipo_contratacion !== undefined ? { tipoContratacion: body.tipo_contratacion } : {}),
    ...(body.tipo_procedimiento !== undefined ? { tipoProcedimiento: body.tipo_procedimiento } : {}),
    ...(body.dependencia !== undefined ? { dependencia: body.dependencia } : {}),
    ...(body.siglas !== undefined ? { siglas: body.siglas } : {}),
    ...(body.entidad_federativa !== undefined ? { entidadFederativa: body.entidad_federativa } : {}),
    ...(body.q !== undefined ? { q: body.q } : {}),
  };
}

function serialize(s: SavedSearchRecord) {
  return {
    id: s.id,
    name: s.name,
    filters: {
      tipo_contratacion: s.filters.tipoContratacion ?? null,
      tipo_procedimiento: s.filters.tipoProcedimiento ?? null,
      dependencia: s.filters.dependencia ?? null,
      siglas: s.filters.siglas ?? null,
      entidad_federativa: s.filters.entidadFederativa ?? null,
      q: s.filters.q ?? null,
    },
    active: s.active,
    created_at: s.createdAt.toISOString(),
  };
}

/**
 * Todas las rutas requieren sesión — montado en /api/admin/saved-searches.
 * A diferencia de /admin/users y /admin/api-keys, aquí cada cuenta solo ve y
 * administra SUS PROPIAS búsquedas (son datos personales de seguimiento, no
 * configuración compartida del equipo).
 */
export function createAdminSavedSearchesRouter(deps: { savedSearches: SavedSearchRepository; users: UserRepository }): Router {
  const router = Router();
  router.use(createRequireAdmin(deps.users));

  router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const currentUser = getCurrentUser(res)!;
      const rows = await deps.savedSearches.listByUser(currentUser.id);
      res.json({ data: rows.map(serialize) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const currentUser = getCurrentUser(res)!;
      const body = createBody.parse(req.body);
      const created = await deps.savedSearches.create({
        userId: currentUser.id,
        name: body.name,
        filters: toDomainFilters(body.filters),
      });
      res.status(201).json(serialize(created));
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:id', async (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        res.status(400).json({ error: 'invalid_id' });
        return;
      }
      const currentUser = getCurrentUser(res)!;
      const existing = await deps.savedSearches.findById(id);
      if (!existing || existing.userId !== currentUser.id) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      const body = updateBody.parse(req.body);
      const updated = await deps.savedSearches.update(id, {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.filters !== undefined ? { filters: toDomainFilters(body.filters) } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
      });
      res.json(serialize(updated!));
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', async (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        res.status(400).json({ error: 'invalid_id' });
        return;
      }
      const currentUser = getCurrentUser(res)!;
      const existing = await deps.savedSearches.findById(id);
      if (!existing || existing.userId !== currentUser.id) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      await deps.savedSearches.delete(id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  router.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof z.ZodError) {
      res.status(400).json({
        error: 'invalid_body',
        issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
      return;
    }
    next(err);
  });

  return router;
}
```

- [ ] **Step 4: Montar el router en `server.ts`**

Editar `apps/backend/src/presentation/server.ts`. Agregar el import junto a los otros de rutas admin:

```ts
import { createAdminSavedSearchesRouter } from './routes/admin-saved-searches.js';
import { DrizzleSavedSearchRepository } from '../infrastructure/db/repositories/saved-search-repository.js';
```

En la composición root, junto a `const userRepo = new DrizzleUserRepository(dbClient);`:

```ts
const savedSearchRepo = new DrizzleSavedSearchRepository(dbClient);
```

Y junto al resto de los `app.use('/api/admin/...')`:

```ts
app.use('/api/admin/saved-searches', createAdminSavedSearchesRouter({ savedSearches: savedSearchRepo, users: userRepo }));
```

(El wiring completo y ordenado de `server.ts` se termina de verificar en el Task 9 — este paso solo agrega lo mínimo para que el test de este Task pase.)

- [ ] **Step 5: Correr el test y confirmar que pasa**

```bash
cd apps/backend && pnpm exec vitest run src/presentation/admin-saved-searches.integration.test.ts
```

Expected: 4/4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/presentation/routes/admin-saved-searches.ts apps/backend/src/presentation/admin-saved-searches.integration.test.ts apps/backend/src/presentation/server.ts
git commit -m "feat(alertas): agrega router admin-saved-searches (CRUD por usuario)"
```

---

## Task 8: Email en cuentas — `admin-users` y `admin-auth`

**Files:**
- Modify: `apps/backend/src/domain/repositories/user-repository.ts` (agrega `findByEmail`)
- Modify: `apps/backend/src/infrastructure/db/repositories/user-repository.ts` (implementa `findByEmail`)
- Modify: `apps/backend/src/presentation/routes/admin-users.ts` (acepta/serializa `email`, valida duplicados)
- Modify: `apps/backend/src/presentation/routes/admin-auth.ts` (`/me` incluye `email`)

**Interfaces:**
- Consumes: `UserRepository` (Task 6).
- Produces: `email` visible en `GET/POST/PATCH /api/admin/users` y en `GET /api/admin/me` — usado por Task 10-11 (frontend).

- [ ] **Step 1: Agregar `findByEmail` a `UserRepository`**

Editar `apps/backend/src/domain/repositories/user-repository.ts`, agregar a la interfaz (después de `findById`):

```ts
  findByEmail(email: string): Promise<UserRecord | null>;
```

Editar `apps/backend/src/infrastructure/db/repositories/user-repository.ts`, agregar el método (después de `findById`):

```ts
  async findByEmail(email: string): Promise<UserRecord | null> {
    const [row] = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    return row ? toRecord(row) : null;
  }
```

- [ ] **Step 2: Extender `admin-users.ts`**

Leer `apps/backend/src/presentation/routes/admin-users.ts` actual y aplicar estos cambios (mismo patrón que `username_taken` ya usa el archivo):

```ts
const createBody = z.object({
  username: z.string().trim().min(1, 'username is required'),
  password: z.string().min(8, 'password must be at least 8 characters'),
  email: z.string().trim().email().optional(),
});

const updateBody = z.object({
  active: z.boolean().optional(),
  password: z.string().min(8).optional(),
  email: z.string().trim().email().nullable().optional(),
});

function serialize(u: UserRecord) {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    active: u.active,
    last_login_at: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
    created_at: u.createdAt.toISOString(),
  };
}
```

En el handler `POST /`, después del chequeo de `username_taken` existente, agregar el chequeo de email duplicado y pasar `email` al `create`:

```ts
  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = createBody.parse(req.body);
      const existing = await deps.users.findByUsername(body.username);
      if (existing) {
        res.status(409).json({ error: 'username_taken', message: 'Ese nombre de usuario ya existe.' });
        return;
      }
      if (body.email) {
        const existingEmail = await deps.users.findByEmail(body.email);
        if (existingEmail) {
          res.status(409).json({ error: 'email_taken', message: 'Ese email ya está en uso por otra cuenta.' });
          return;
        }
      }
      const passwordHash = await hashPassword(body.password);
      const created = await deps.users.create({ username: body.username, passwordHash, email: body.email ?? null });
      res.status(201).json(serialize(created));
    } catch (err) {
      next(err);
    }
  });
```

En el handler `PATCH /:id`, agregar el chequeo de email duplicado (excluyendo al propio usuario) y sumar `email` al patch:

```ts
        const body = updateBody.parse(req.body);

        if (body.email) {
          const existingEmail = await deps.users.findByEmail(body.email);
          if (existingEmail && existingEmail.id !== id) {
            res.status(409).json({ error: 'email_taken', message: 'Ese email ya está en uso por otra cuenta.' });
            return;
          }
        }

        // Guard: never let the last active account be deactivated — ...
        if (body.active === false) {
          const others = await deps.users.countOtherActive(id);
          if (others === 0) {
            res.status(409).json({
              error: 'last_active_user',
              message: 'No puedes desactivar la última cuenta activa.',
            });
            return;
          }
        }

        const patch: { active?: boolean; passwordHash?: string; email?: string | null } = {};
        if (body.active !== undefined) patch.active = body.active;
        if (body.password !== undefined) patch.passwordHash = await hashPassword(body.password);
        if (body.email !== undefined) patch.email = body.email;
```

- [ ] **Step 3: Extender `/me` en `admin-auth.ts`**

Editar `apps/backend/src/presentation/routes/admin-auth.ts`. El handler `GET /me` actual termina así:

```ts
      const user = await deps.users.findByUsername(payload.sub);
      const ok = user !== null && user.active && user.id === payload.uid;
      res.json({ authenticated: ok, username: ok ? user!.username : null, user_id: ok ? user!.id : null });
```

Reemplazar esas dos últimas líneas (dejar la búsqueda de `user`/`ok` igual) por:

```ts
      const user = await deps.users.findByUsername(payload.sub);
      const ok = user !== null && user.active && user.id === payload.uid;
      res.json({
        authenticated: ok,
        username: ok ? user!.username : null,
        user_id: ok ? user!.id : null,
        email: ok ? user!.email : null,
      });
```

También en el early-return de "no hay token válido" (unas líneas arriba), agregar `email: null` para que la forma de la respuesta sea consistente en ambos casos:

```ts
      if (!payload) {
        res.json({ authenticated: false, username: null, user_id: null, email: null });
        return;
      }
```

- [ ] **Step 4: Typecheck + suite completa**

```bash
cd apps/backend && pnpm exec tsc --noEmit && pnpm test
```

Expected: typecheck limpio, todos los tests pasan.

- [ ] **Step 5: Verificación manual del flujo completo (curl)**

```bash
cd apps/backend && pnpm dev &
sleep 2
curl -s -c /tmp/alerts_cookie.txt -X POST http://localhost:3000/api/admin/login \
  -H 'Content-Type: application/json' -d '{"username":"admin","password":"dev-admin-local-only"}'
curl -s -b /tmp/alerts_cookie.txt -X PATCH http://localhost:3000/api/admin/users/1 \
  -H 'Content-Type: application/json' -d '{"email":"admin@tecnolicity.test"}'
curl -s -b /tmp/alerts_cookie.txt http://localhost:3000/api/admin/me
rm -f /tmp/alerts_cookie.txt
kill %1
```

Expected: el PATCH devuelve el usuario con `"email":"admin@tecnolicity.test"`; `/me` también lo incluye.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/domain/repositories/user-repository.ts apps/backend/src/infrastructure/db/repositories/user-repository.ts apps/backend/src/presentation/routes/admin-users.ts apps/backend/src/presentation/routes/admin-auth.ts
git commit -m "feat(alertas): agrega email a cuentas de usuario (admin-users, /me)"
```

---

## Task 9: Wiring — `server.ts`, `vigente-cron.ts`, `env.ts`, compose

**Files:**
- Modify: `apps/backend/src/infrastructure/scheduler/vigente-cron.ts`
- Modify: `apps/backend/src/presentation/server.ts`
- Modify: `apps/backend/src/config/env.ts`
- Modify: `.env.example`
- Modify: `docker-compose.prod.yml`

**Interfaces:**
- Consumes: `EvaluateAlerts` (Task 6), `ElasticEmailClient`/`NullEmailSender` (Task 4).
- Produces: alertas evaluándose automáticamente tras cada scrape exitoso, en dev y prod.

- [ ] **Step 1: Agregar env vars**

Editar `apps/backend/src/config/env.ts`, agregar antes del cierre de `envSchema` (después de `API_KEY_DEFAULT_RATE_LIMIT_PER_MINUTE`):

```ts
  // --- Email alerts (saved searches, PR13) ----------------------------------
  // Elastic Email API key. Opcional: si no está seteada, la evaluación de
  // alertas sigue corriendo pero los correos solo se loguean (ver
  // infrastructure/email/null-email-sender.ts).
  ELASTIC_EMAIL_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('alertas@tecnolicity.mx'),
```

Editar `.env.example`, agregar al final:

```
# Email alerts (saved searches) — opcional, API de Elastic Email
ELASTIC_EMAIL_API_KEY=
EMAIL_FROM=alertas@tecnolicity.mx
```

- [ ] **Step 2: Modificar `vigente-cron.ts` para aceptar un callback post-scrape**

Editar `apps/backend/src/infrastructure/scheduler/vigente-cron.ts`:

```ts
import cron, { type ScheduledTask } from 'node-cron';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { env } from '../../config/env.js';

/**
 * Daily cron scheduler for the vigente procedures scraper.
 *
 * Spawns the scraper CLI as an **isolated child process** so Playwright's
 * browser doesn't compete with the HTTP server for memory/CPU. The child
 * inherits the parent's env (DATABASE_URL, SCRAPER_* vars, etc.).
 *
 * Configure via .env:
 *   SCRAPE_CRON_ENABLED=true
 *   SCRAPE_CRON_SCHEDULE="0 6 * * *"   # 6 AM daily (default)
 *
 * The cron runs in the server's timezone (process.env.TZ or system default).
 *
 * `onScrapeComplete` (PR13): llamado con el timestamp de inicio del scrape
 * cuando termina exitosamente (exit code 0) — usado para evaluar alertas
 * sobre las vigentes tocadas en esa corrida.
 */

export interface VigenteCronDeps {
  onScrapeComplete?: (scrapeRunStartedAt: Date) => void | Promise<void>;
}

let task: ScheduledTask | null = null;

export function startVigenteCron(deps: VigenteCronDeps = {}): void {
  if (!env.SCRAPE_CRON_ENABLED) {
    console.log(
      '[cron] vigente scraper disabled (set SCRAPE_CRON_ENABLED=true to enable)',
    );
    return;
  }

  if (!cron.validate(env.SCRAPE_CRON_SCHEDULE)) {
    console.error(
      `[cron] invalid schedule expression: "${env.SCRAPE_CRON_SCHEDULE}" — skipping`,
    );
    return;
  }

  console.log(`[cron] vigente scraper scheduled: "${env.SCRAPE_CRON_SCHEDULE}"`);

  task = cron.schedule(env.SCRAPE_CRON_SCHEDULE, () => {
    void runScrape(deps.onScrapeComplete);
  });
}

export function stopVigenteCron(): void {
  if (task) {
    task.stop();
    task = null;
    console.log('[cron] vigente scraper stopped');
  }
}

/**
 * Spawn the scraper CLI as a child process and stream its output.
 * Isolated so a Playwright crash can't take down the HTTP server.
 */
function runScrape(onScrapeComplete?: (scrapeRunStartedAt: Date) => void | Promise<void>): Promise<void> {
  return new Promise((resolvePromise) => {
    const started = new Date();
    console.log(`[cron] ▶ starting vigente scrape at ${started.toISOString()}`);

    const backendDir = resolve(process.cwd(), 'apps/backend');
    const child = spawn(
      'npx',
      ['tsx', 'src/scripts/scrape-vigentes.ts'],
      {
        cwd: backendDir,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    child.stdout?.on('data', (data: Buffer) => {
      const text = data.toString().trim();
      if (!text) return;
      for (const line of text.split('\n')) {
        if (line.trim()) console.log(`[cron]   ${line}`);
      }
    });

    child.stderr?.on('data', (data: Buffer) => {
      const text = data.toString().trim();
      if (text) console.error(`[cron]   ⚠ ${text}`);
    });

    child.on('close', (code: number | null) => {
      const elapsed = ((Date.now() - started.getTime()) / 1000).toFixed(1);
      if (code === 0) {
        console.log(`[cron] ✔ vigente scrape completed in ${elapsed}s`);
        void onScrapeComplete?.(started);
      } else {
        console.error(
          `[cron] ✗ vigente scrape failed (exit ${code}) in ${elapsed}s`,
        );
      }
      resolvePromise();
    });

    child.on('error', (err: Error) => {
      console.error('[cron] ✗ failed to spawn scraper:', err.message);
      resolvePromise();
    });
  });
}
```

- [ ] **Step 3: Construir `EvaluateAlerts` en `startServer()` y pasarlo al cron**

Editar `apps/backend/src/presentation/server.ts`. Agregar imports:

```ts
import { DrizzleSavedSearchMatchRepository } from '../infrastructure/db/repositories/saved-search-match-repository.js';
import { ElasticEmailClient } from '../infrastructure/email/elastic-email-client.js';
import { NullEmailSender } from '../infrastructure/email/null-email-sender.js';
import { EvaluateAlerts } from '../application/alerts/evaluate-alerts.js';
import type { EmailSender } from '../domain/email/email-sender.js';
```

(`DrizzleSavedSearchRepository` ya se importó en el Task 7.)

Reemplazar `startServer()` completo:

```ts
/** Start listening. Call once from the process entry point. */
export async function startServer(): Promise<{ app: Express; close: () => Promise<void> }> {
  // Seed the first login account before accepting any requests — a no-op
  // once at least one user exists (see bootstrap-admin.ts).
  await bootstrapAdminUser(new DrizzleUserRepository(db), env.ADMIN_USERNAME, env.ADMIN_PASSWORD);

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    console.log(`[backend] listening on :${env.PORT} (${env.NODE_ENV})`);
  });

  // Alertas por email (PR13) — se evalúan tras cada scrape exitoso del cron.
  const emailSender: EmailSender = env.ELASTIC_EMAIL_API_KEY
    ? new ElasticEmailClient(env.ELASTIC_EMAIL_API_KEY, env.EMAIL_FROM)
    : new NullEmailSender();
  const evaluateAlerts = new EvaluateAlerts({
    savedSearches: new DrizzleSavedSearchRepository(db),
    matches: new DrizzleSavedSearchMatchRepository(db),
    vigentes: new DrizzleVigenteRepository(db),
    users: new DrizzleUserRepository(db),
    email: emailSender,
    baseUrl: env.CORS_ORIGIN,
  });

  // Start the daily vigente scraper cron (configured via SCRAPE_CRON_*).
  startVigenteCron({
    onScrapeComplete: async (scrapeRunStartedAt) => {
      try {
        const summary = await evaluateAlerts.execute(scrapeRunStartedAt);
        console.log(
          `[alerts] evaluó ${summary.searchesEvaluated} búsqueda(s), notificó a ${summary.usersNotified} usuario(s) (${summary.eventsDetected} evento(s))`,
        );
      } catch (err) {
        console.error('[alerts] falló la evaluación de alertas:', err);
      }
    },
  });

  return {
    app,
    close: async () => {
      stopVigenteCron();
      server.close();
      await pool.end();
    },
  };
}
```

- [ ] **Step 4: Propagar las nuevas env vars en `docker-compose.prod.yml`**

Editar `docker-compose.prod.yml`, agregar después de `API_KEY_DEFAULT_RATE_LIMIT_PER_MINUTE: ${API_KEY_DEFAULT_RATE_LIMIT_PER_MINUTE:-300}` dentro del bloque `environment:` del servicio `backend`:

```yaml
      # Email alerts (saved searches, PR13). Opcional — si no está seteada,
      # las alertas se evalúan pero los correos solo se loguean.
      ELASTIC_EMAIL_API_KEY: ${ELASTIC_EMAIL_API_KEY:-}
      EMAIL_FROM: ${EMAIL_FROM:-alertas@tecnolicity.mx}
```

- [ ] **Step 5: Typecheck + suite completa + arranque manual**

```bash
cd apps/backend && pnpm exec tsc --noEmit && pnpm test
```

Expected: typecheck limpio, todos los tests pasan.

```bash
docker compose -f docker-compose.yml up -d && sleep 3
cd apps/backend && pnpm db:migrate
SCRAPE_CRON_ENABLED=false pnpm dev &
sleep 2
curl -s http://localhost:3000/api/health
curl -s -c /tmp/alerts_cookie2.txt -X POST http://localhost:3000/api/admin/login \
  -H 'Content-Type: application/json' -d '{"username":"admin","password":"dev-admin-local-only"}'
curl -s -b /tmp/alerts_cookie2.txt -X POST http://localhost:3000/api/admin/saved-searches \
  -H 'Content-Type: application/json' -d '{"name":"prueba","filters":{"q":"software"}}'
rm -f /tmp/alerts_cookie2.txt
kill %1
```

Expected: el servidor arranca sin el error `Environment validation failed` (las nuevas vars son opcionales/tienen default), y la búsqueda guardada se crea correctamente.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/infrastructure/scheduler/vigente-cron.ts apps/backend/src/presentation/server.ts apps/backend/src/config/env.ts .env.example docker-compose.prod.yml
git commit -m "feat(alertas): conecta EvaluateAlerts al cron del scraper + env vars de Elastic Email"
```

---

## Task 10: Frontend — tipos y hooks de React Query

**Files:**
- Modify: `apps/frontend/src/types/index.ts`
- Modify: `apps/frontend/src/api/admin-queries.ts`

**Interfaces:**
- Produces: `SavedSearch`, `SavedSearchFilters` (tipos), `useSavedSearches`, `useCreateSavedSearch`, `useUpdateSavedSearch`, `useDeleteSavedSearch` — usados por Task 11.

- [ ] **Step 1: Agregar tipos**

Editar `apps/frontend/src/types/index.ts`. Extender `AdminSession` y `UserSummary`, y agregar los tipos de saved search (junto a la sección `// --- Admin: users (PR12) ---`):

```ts
export interface AdminSession {
  authenticated: boolean;
  username: string | null;
  user_id: number | null;
  email: string | null;
}

export interface UserSummary {
  id: number;
  username: string;
  email: string | null;
  active: boolean;
  last_login_at: string | null;
  created_at: string;
}

// --- Admin: saved searches / alertas (PR13) ---

export interface SavedSearchFilters {
  tipo_contratacion?: string | null;
  tipo_procedimiento?: string | null;
  dependencia?: string | null;
  siglas?: string | null;
  entidad_federativa?: string | null;
  q?: string | null;
}

export interface SavedSearch {
  id: number;
  name: string;
  filters: SavedSearchFilters;
  active: boolean;
  created_at: string;
}
```

- [ ] **Step 2: Agregar los hooks**

Editar `apps/frontend/src/api/admin-queries.ts`. Actualizar el import de tipos:

```ts
import type { AdminSession, ApiKeySummary, ApiKeyCreated, UserSummary, SavedSearch, SavedSearchFilters } from '../types';
```

Actualizar `useCreateUser` y `useUpdateUser` para aceptar `email` (mismo archivo, funciones ya existentes de PR12):

```ts
export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { username: string; password: string; email?: string }) =>
      apiPost<UserSummary>('/admin/users', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: number; active?: boolean; password?: string; email?: string | null }) =>
      apiPatch<UserSummary>(`/admin/users/${id}`, patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
  });
}
```

Agregar al final del archivo:

```ts
export function useSavedSearches() {
  return useQuery({
    queryKey: ['admin', 'saved-searches'],
    queryFn: ({ signal }) => apiGet<{ data: SavedSearch[] }>('/admin/saved-searches', undefined, { signal }),
  });
}

export function useCreateSavedSearch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; filters: SavedSearchFilters }) =>
      apiPost<SavedSearch>('/admin/saved-searches', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'saved-searches'] });
    },
  });
}

export function useUpdateSavedSearch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: number; name?: string; filters?: SavedSearchFilters; active?: boolean }) =>
      apiPatch<SavedSearch>(`/admin/saved-searches/${id}`, patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'saved-searches'] });
    },
  });
}

export function useDeleteSavedSearch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiDelete<void>(`/admin/saved-searches/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'saved-searches'] });
    },
  });
}
```

- [ ] **Step 3: Typecheck**

```bash
cd apps/frontend && pnpm exec tsc --noEmit
```

Expected: sin errores (nota: si `AdminUsersPage.tsx` todavía no usa `email`, el typecheck igual pasa porque los campos nuevos son opcionales en los inputs de los hooks; `UserSummary.email` no-opcional se satisface porque el backend ya lo serializa desde el Task 8).

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/types/index.ts apps/frontend/src/api/admin-queries.ts
git commit -m "feat(alertas): agrega tipos y hooks de React Query para saved searches"
```

---

## Task 11: Frontend — página de Alertas, email en Usuarios, routing y nav

**Files:**
- Create: `apps/frontend/src/pages/AdminAlertsPage.tsx`
- Modify: `apps/frontend/src/pages/AdminUsersPage.tsx`
- Modify: `apps/frontend/src/App.tsx`
- Modify: `apps/frontend/src/components/Layout.tsx`

**Interfaces:**
- Consumes: hooks de Task 10, `Badge`/`Button`/`Card`/`CardHeader`/`EmptyState`/`ErrorBanner`/`Skeleton`/`Spinner` de `components/ui` (existente), `ScrollShadowX` (existente).

- [ ] **Step 1: Agregar el campo email a `AdminUsersPage.tsx`**

En `CreateUserForm`, agregar el estado y el input de email, y pasarlo en `create.mutate`:

```tsx
function CreateUserForm() {
  const create = useCreateUser();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!username.trim() || password.length < 8) return;
    create.mutate(
      { username: username.trim(), password, ...(email.trim() ? { email: email.trim() } : {}) },
      {
        onSuccess: () => {
          setUsername('');
          setPassword('');
          setEmail('');
        },
      },
    );
  }
```

Agregar el `<div>` del input de email en el JSX del form, entre el de contraseña y el botón:

```tsx
      <div className="min-w-[12rem] flex-1">
        <label className="mb-1 block text-xs font-medium text-slate-600">Email (opcional)</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="para alertas"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-institucional focus:outline-none focus:ring-1 focus:ring-institucional"
        />
      </div>
```

En `UsersTable`, agregar una columna de email (después de "Usuario") y un mini-form de edición (mismo patrón que `ResetPasswordForm`). Agregar el estado y el componente:

```tsx
function UsersTable({ users, currentUserId }: { users: UserSummary[]; currentUserId: number | null }) {
  const update = useUpdateUser();
  const del = useDeleteUser();
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [resetId, setResetId] = useState<number | null>(null);
  const [editEmailId, setEditEmailId] = useState<number | null>(null);

  return (
    <ScrollShadowX>
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <th className="px-4 py-2.5">Usuario</th>
            <th className="px-4 py-2.5">Email</th>
            <th className="px-4 py-2.5">Último acceso</th>
            <th className="px-4 py-2.5">Estado</th>
            <th className="px-4 py-2.5" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {users.map((u) => {
            const isSelf = u.id === currentUserId;
            return (
              <tr key={u.id} className="hover:bg-institucional-50/40">
                <td className="px-4 py-3 align-top">
                  <div className="font-medium text-slate-900">
                    {u.username} {isSelf && <span className="text-xs font-normal text-slate-400">(tú)</span>}
                  </div>
                </td>
                <td className="px-4 py-3 align-top">
                  {editEmailId === u.id ? (
                    <EditEmailForm userId={u.id} onDone={() => setEditEmailId(null)} onCancel={() => setEditEmailId(null)} />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setEditEmailId(u.id)}
                      className="text-xs text-slate-600 hover:text-institucional hover:underline"
                    >
                      {u.email ?? 'Sin email — click para agregar'}
                    </button>
                  )}
                </td>
                <td className="px-4 py-3 align-top text-xs text-slate-500">
                  {u.last_login_at ? formatDateTime(u.last_login_at) : 'Nunca'}
                </td>
                <td className="px-4 py-3 align-top">
                  <Badge tone={u.active ? 'success' : 'neutral'}>{u.active ? 'Activo' : 'Desactivado'}</Badge>
                </td>
                <td className="px-4 py-3 align-top">
                  <div className="flex justify-end gap-2">
                    {resetId === u.id ? (
                      <ResetPasswordForm
                        userId={u.id}
                        onDone={() => setResetId(null)}
                        onCancel={() => setResetId(null)}
                      />
                    ) : (
                      <>
                        <Button variant="ghost" size="sm" type="button" onClick={() => setResetId(u.id)}>
                          Cambiar contraseña
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          type="button"
                          disabled={update.isPending || isSelf}
                          title={isSelf ? 'No puedes desactivar tu propia cuenta' : undefined}
                          onClick={() => update.mutate({ id: u.id, active: !u.active })}
                        >
                          {u.active ? 'Desactivar' : 'Reactivar'}
                        </Button>
                        {confirmId === u.id ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            type="button"
                            disabled={del.isPending}
                            onClick={() => {
                              del.mutate(u.id);
                              setConfirmId(null);
                            }}
                          >
                            ¿Seguro? Eliminar
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            type="button"
                            disabled={isSelf}
                            title={isSelf ? 'No puedes eliminar tu propia cuenta' : undefined}
                            onClick={() => setConfirmId(u.id)}
                          >
                            Eliminar
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </ScrollShadowX>
  );
}

function EditEmailForm({ userId, onDone, onCancel }: { userId: number; onDone: () => void; onCancel: () => void }) {
  const update = useUpdateUser();
  const [email, setEmail] = useState('');

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    update.mutate({ id: userId, email: email.trim() || null }, { onSuccess: onDone });
  }

  return (
    <form onSubmit={onSubmit} className="flex items-center gap-2">
      <input
        type="email"
        autoFocus
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="email@ejemplo.com"
        className="w-44 rounded-md border border-slate-300 px-2 py-1.5 text-xs focus:border-institucional focus:outline-none focus:ring-1 focus:ring-institucional"
      />
      <Button type="submit" size="sm" disabled={update.isPending}>
        {update.isPending ? <Spinner className="h-3 w-3" /> : 'Guardar'}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
        Cancelar
      </Button>
    </form>
  );
}
```

- [ ] **Step 2: Crear `AdminAlertsPage.tsx`**

Crear `apps/frontend/src/pages/AdminAlertsPage.tsx`:

```tsx
import { useState, type FormEvent } from 'react';
import { Navigate, Link } from 'react-router-dom';
import {
  useAdminSession,
  useSavedSearches,
  useCreateSavedSearch,
  useUpdateSavedSearch,
  useDeleteSavedSearch,
} from '../api/admin-queries';
import type { SavedSearch, SavedSearchFilters } from '../types';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBanner, Skeleton, Spinner } from '../components/ui';
import { ScrollShadowX } from '../components/ScrollShadowX';

/**
 * Admin panel: búsquedas guardadas sobre vigentes. Cada una genera un correo
 * digest cuando aparece una nueva coincidencia, hay un cambio de estatus, o
 * el cierre está próximo (evaluado tras el scrape diario, ver EvaluateAlerts
 * en el backend).
 */
export function AdminAlertsPage() {
  const session = useAdminSession();

  if (session.isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
        <Spinner className="h-5 w-5 text-institucional" /> Verificando sesión…
      </div>
    );
  }
  if (!session.data?.authenticated) {
    return <Navigate to="/admin/login" replace />;
  }
  return <AlertsManager hasEmail={!!session.data.email} />;
}

function AlertsManager({ hasEmail }: { hasEmail: boolean }) {
  const searches = useSavedSearches();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-xl font-semibold text-slate-900">Alertas</h1>
        <p className="text-sm text-slate-500">
          Búsquedas guardadas sobre licitaciones vigentes — te llega un correo cuando hay algo nuevo.
        </p>
      </div>

      {!hasEmail && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          Configura tu email en{' '}
          <Link to="/admin/users" className="font-semibold underline">
            tu cuenta
          </Link>{' '}
          para recibir alertas — sin eso, tus búsquedas se evalúan pero no se te avisa.
        </div>
      )}

      <Card>
        <CardHeader title="Nueva búsqueda guardada" subtitle="Los mismos filtros que la lista de vigentes" />
        <div className="p-4">
          <CreateSavedSearchForm />
        </div>
      </Card>

      <Card>
        <CardHeader title="Tus búsquedas" subtitle={searches.data ? `${searches.data.data.length} en total` : undefined} />
        {searches.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : searches.isError ? (
          <div className="p-4">
            <ErrorBanner message="No se pudieron cargar las búsquedas guardadas." onRetry={() => void searches.refetch()} />
          </div>
        ) : searches.data!.data.length === 0 ? (
          <EmptyState title="Sin búsquedas guardadas" hint="Crea la primera arriba." />
        ) : (
          <SavedSearchesTable searches={searches.data!.data} />
        )}
      </Card>
    </div>
  );
}

function CreateSavedSearchForm() {
  const create = useCreateSavedSearch();
  const [name, setName] = useState('');
  const [filters, setFilters] = useState<SavedSearchFilters>({});

  function setFilter(key: keyof SavedSearchFilters, value: string) {
    setFilters((f) => ({ ...f, [key]: value.trim() || undefined }));
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    create.mutate(
      { name: name.trim(), filters },
      {
        onSuccess: () => {
          setName('');
          setFilters({});
        },
      },
    );
  }

  const inputClass =
    'w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-institucional focus:outline-none focus:ring-1 focus:ring-institucional';

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      {create.isError && <ErrorBanner message="No se pudo crear la búsqueda guardada." />}
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">Nombre *</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Obra pública SICT" className={inputClass} required />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Palabra clave</label>
          <input type="text" value={filters.q ?? ''} onChange={(e) => setFilter('q', e.target.value)} placeholder="ej. software" className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Siglas dependencia</label>
          <input type="text" value={filters.siglas ?? ''} onChange={(e) => setFilter('siglas', e.target.value)} placeholder="ej. SICT" className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Dependencia</label>
          <input type="text" value={filters.dependencia ?? ''} onChange={(e) => setFilter('dependencia', e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Tipo de contratación</label>
          <input type="text" value={filters.tipo_contratacion ?? ''} onChange={(e) => setFilter('tipo_contratacion', e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Tipo de procedimiento</label>
          <input type="text" value={filters.tipo_procedimiento ?? ''} onChange={(e) => setFilter('tipo_procedimiento', e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Entidad federativa</label>
          <input type="text" value={filters.entidad_federativa ?? ''} onChange={(e) => setFilter('entidad_federativa', e.target.value)} className={inputClass} />
        </div>
      </div>
      <Button type="submit" disabled={create.isPending || !name.trim()}>
        {create.isPending ? <Spinner className="h-4 w-4" /> : 'Crear búsqueda guardada'}
      </Button>
    </form>
  );
}

function SavedSearchesTable({ searches }: { searches: SavedSearch[] }) {
  const update = useUpdateSavedSearch();
  const del = useDeleteSavedSearch();
  const [confirmId, setConfirmId] = useState<number | null>(null);

  function summarizeFilters(f: SavedSearchFilters): string {
    const parts = [f.q, f.siglas, f.dependencia, f.tipo_contratacion, f.tipo_procedimiento, f.entidad_federativa].filter(Boolean);
    return parts.length > 0 ? parts.join(' · ') : 'Sin filtros (todas las vigentes)';
  }

  return (
    <ScrollShadowX>
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <th className="px-4 py-2.5">Nombre</th>
            <th className="px-4 py-2.5">Filtros</th>
            <th className="px-4 py-2.5">Estado</th>
            <th className="px-4 py-2.5" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {searches.map((s) => (
            <tr key={s.id} className="hover:bg-institucional-50/40">
              <td className="px-4 py-3 align-top font-medium text-slate-900">{s.name}</td>
              <td className="px-4 py-3 align-top text-xs text-slate-500">{summarizeFilters(s.filters)}</td>
              <td className="px-4 py-3 align-top">
                <Badge tone={s.active ? 'success' : 'neutral'}>{s.active ? 'Activa' : 'Pausada'}</Badge>
              </td>
              <td className="px-4 py-3 align-top">
                <div className="flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    disabled={update.isPending}
                    onClick={() => update.mutate({ id: s.id, active: !s.active })}
                  >
                    {s.active ? 'Pausar' : 'Reactivar'}
                  </Button>
                  {confirmId === s.id ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      type="button"
                      disabled={del.isPending}
                      onClick={() => {
                        del.mutate(s.id);
                        setConfirmId(null);
                      }}
                    >
                      ¿Seguro? Eliminar
                    </Button>
                  ) : (
                    <Button variant="ghost" size="sm" type="button" onClick={() => setConfirmId(s.id)}>
                      Eliminar
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollShadowX>
  );
}
```

- [ ] **Step 3: Wire route + nav**

Editar `apps/frontend/src/App.tsx`, agregar el lazy import (junto a `AdminApiKeysPage`/`AdminUsersPage`):

```ts
const AdminAlertsPage = lazy(() =>
  import('./pages/AdminAlertsPage').then((m) => ({ default: m.AdminAlertsPage })),
);
```

Agregar la ruta (junto a `/admin/users`):

```tsx
              <Route
                path="/admin/alertas"
                element={
                  <Suspense fallback={<RouteFallback>Cargando…</RouteFallback>}>
                    <AdminAlertsPage />
                  </Suspense>
                }
              />
```

Editar `apps/frontend/src/components/Layout.tsx`, agregar el link (junto a `/admin/users`):

```ts
  { to: '/admin/alertas', label: 'Alertas', end: false },
```

- [ ] **Step 4: Typecheck**

```bash
cd apps/frontend && pnpm exec tsc --noEmit
```

Expected: sin errores.

- [ ] **Step 5: Verificación en el navegador**

Levantar backend + Postgres + frontend dev server (mismo flujo usado en PR12: `docker compose -f docker-compose.yml up -d`, `pnpm db:migrate`, `pnpm dev` en `apps/backend`, `preview_start` del frontend). En el navegador:

1. Login → ir a `/admin/users` → confirmar que aparece la columna Email y se puede editar.
2. Ir a `/admin/alertas` → si el usuario no tiene email, confirmar el banner de aviso con link a `/admin/users`.
3. Crear una búsqueda guardada con algún filtro (ej. `q=software`) → confirmar que aparece en la tabla con el resumen de filtros correcto.
4. Pausar/reactivar la búsqueda → confirmar que el badge cambia.
5. Eliminar con el flujo de doble confirmación → confirmar que desaparece de la tabla.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/pages/AdminAlertsPage.tsx apps/frontend/src/pages/AdminUsersPage.tsx apps/frontend/src/App.tsx apps/frontend/src/components/Layout.tsx
git commit -m "feat(alertas): agrega página de Alertas + email en Usuarios + routing/nav"
```

---

## Verificación final (todas las tareas completas)

- [ ] `cd apps/backend && pnpm exec tsc --noEmit && pnpm test` → typecheck limpio, todos los tests pasan (existentes + los agregados en este plan).
- [ ] `cd apps/frontend && pnpm exec tsc --noEmit` → typecheck limpio.
- [ ] Verificación manual en navegador del flujo completo de Alertas (Task 11, Step 5).
- [ ] Con un `ELASTIC_EMAIL_API_KEY` real configurado en `.env`, correr manualmente `EvaluateAlerts` una vez (o forzar el cron) y confirmar que llega un correo real a una cuenta de prueba — esto NO se puede automatizar en tests (nunca se manda correo real en la suite), así que es la única verificación end-to-end pendiente antes de dar la feature por completamente probada en producción.
- [ ] Limpieza de artefactos de prueba: parar `docker compose -f docker-compose.yml down`, borrar cookies temporales en `/tmp/alerts_cookie*.txt`.
- [ ] Revisar el diff completo (`git log` de esta rama) antes de hacer push a `main`.
