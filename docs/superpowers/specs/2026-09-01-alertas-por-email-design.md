# Alertas por email — diseño

**Fecha:** 2026-09-01
**Estado:** Aprobado para implementación

## Contexto

Tecnolicity es un portal de transparencia/consulta sobre contrataciones públicas
mexicanas (histórico + "vigentes" scrapeadas en vivo de ComprasMX). Comparado
contra un competidor comercial (ARGOS Inteligencia), una de las brechas más
baratas de cerrar es la falta de alertas activas: hoy el usuario tiene que
entrar al portal y consultar; no hay forma de que el sistema le avise cuando
aparece o cambia algo relevante.

Esta es la primera de tres piezas identificadas (alertas → score de
oportunidad → análisis de bases con IA). Cada una se diseña e implementa por
separado. Este documento cubre solo **alertas por email**.

## Objetivo

Cada usuario (cuenta del panel admin) puede guardar criterios de búsqueda
sobre licitaciones vigentes y recibir un correo cuando:

1. Aparece una vigente nueva que matchea sus criterios.
2. Una vigente que ya matcheaba está por cerrar (≤3 días).
3. Una vigente que ya matcheaba cambia de estatus.

## Decisiones de diseño

| Decisión | Elegido |
|---|---|
| Tipos de alerta en MVP | Las tres: nueva coincidencia, cierre próximo, cambio de estatus |
| Alcance de las búsquedas guardadas | Por usuario (no compartidas) |
| Resolución del email de destino | Se agrega `email` al perfil de usuario (`users` table) |
| Proveedor de envío | Elastic Email (API HTTP, no SMTP) |
| Forma de los criterios | Mismos filtros que `GET /vigentes`: `tipo_contratacion`, `tipo_procedimiento`, `dependencia`, `siglas`, `entidad_federativa`, `q` |
| Disparador | Pegado al cron diario existente del scraper de vigentes (no un cron nuevo) |
| Prevención de duplicados | Tabla de estado `saved_search_matches` (no re-notifica el mismo evento) |
| Umbral de "cierre próximo" | Fijo: 3 días antes de `fecha_presentacion_apertura` |
| Transición de estatus que dispara alerta | Cualquier cambio de valor |
| Agrupación de correos | Un digest por usuario por corrida del cron (no un correo por evento) |

## Arquitectura y flujo

El cron diario existente (`apps/backend/src/infrastructure/scheduler/vigente-cron.ts`)
spawnea el scraper como child process aislado (Playwright no debe competir con
el servidor HTTP). Hoy, en `child.on('close', ...)` solo se loguea el
resultado. Se agrega ahí un paso más: si `code === 0`, se ejecuta
`EvaluateAlerts.execute()` **dentro del proceso del servidor** (no en el
child — solo necesita leer/escribir Postgres y llamar a la API de Elastic
Email, no Playwright).

```
cron diario → scraper (child process) → exit 0
                                            ↓
                                   EvaluateAlerts.execute()
                                            ↓
                    por cada saved_search activa: matchear vigentes
                                            ↓
                    detectar eventos (new_match / closing_soon / status_change)
                                            ↓
                    agrupar eventos por user_id
                                            ↓
                    por usuario: armar digest → enviar vía Elastic Email
                                            ↓
                    solo si el envío fue exitoso: persistir el estado como "notificado"
```

## Modelo de datos

### `users` (modificación)

Se agrega una columna:

- `email` (text, nullable, unique) — si es `null`, ese usuario no recibe
  alertas. El panel de Alertas se lo indica con un aviso y link a su cuenta.

### `saved_searches` (nueva tabla)

```
id            serial PK
user_id       integer NOT NULL  → FK users.id (ON DELETE CASCADE)
name          text NOT NULL          -- ej. "Obra pública SICT Jalisco"
filters       jsonb NOT NULL         -- { tipo_contratacion?, tipo_procedimiento?,
                                      --   dependencia?, siglas?, entidad_federativa?, q? }
active        boolean NOT NULL DEFAULT true
created_at    timestamptz NOT NULL DEFAULT now()
```

`filters` se guarda como jsonb (mismo shape que ya acepta `GET /vigentes`) para
no requerir una migración de schema si se agrega un filtro nuevo a futuro.

### `saved_search_matches` (nueva tabla — estado + dedupe)

```
id                        serial PK
saved_search_id           integer NOT NULL → FK saved_searches.id (ON DELETE CASCADE)
vigente_id                integer NOT NULL → FK vigente_procedures.id (ON DELETE CASCADE)
last_estatus               text            -- último estatus visto
closing_soon_notified_at  timestamptz     -- null hasta que se notifica una vez
created_at                timestamptz NOT NULL DEFAULT now()

UNIQUE (saved_search_id, vigente_id)
```

Semántica de cada tipo de evento durante la evaluación:

- **new_match**: no existe fila en `saved_search_matches` para el par
  `(saved_search_id, vigente_id)` **y** `vigente_procedures.created_at` cae
  dentro de la ventana de la corrida actual del scraper → se crea la fila y
  se dispara el evento. Si no existe la fila pero la vigente ya era vieja
  (búsqueda guardada nueva contra historial existente), se crea la fila como
  línea base **sin** disparar alerta — evita inundar de correos al crear una
  búsqueda nueva contra datos ya existentes.
- **status_change**: existe la fila y `last_estatus` ≠ estatus actual →
  evento. `last_estatus` se actualiza solo **después** de que el correo se
  envía con éxito.
- **closing_soon**: `fecha_presentacion_apertura` está a ≤3 días, no ha
  pasado, y `closing_soon_notified_at` es `null` → evento; se marca el
  timestamp solo tras el envío exitoso.

`vigente_procedures.created_at` ya existe y se preserva en cada upsert
(`onConflictDoUpdate` no lo toca — ver
`infrastructure/db/repositories/vigente-repository.ts`), así que "nueva desde
la última corrida" no requiere ningún cambio en el scraper.

## Componentes backend

Mismo patrón hexagonal que el resto del proyecto (dominio → aplicación →
infraestructura → presentación).

**Dominio** (`domain/repositories/`):
- `SavedSearchRepository` — CRUD + `listActive()` (todas las activas de todos
  los usuarios, para la evaluación).
- `SavedSearchMatchRepository` — `find(savedSearchId, vigenteId)`,
  `upsert(...)`, y una consulta de vigentes candidatas por búsqueda (reusa la
  misma lógica de filtrado que `DrizzleVigenteRepository.list`, sin paginar).

**Infraestructura** (`infrastructure/`):
- `db/repositories/drizzle-saved-search-repository.ts`,
  `drizzle-saved-search-match-repository.ts` — implementaciones Drizzle.
- `email/elastic-email-client.ts` — cliente delgado sobre la API HTTP de
  Elastic Email. Env vars nuevas: `ELASTIC_EMAIL_API_KEY`, `EMAIL_FROM`.

**Aplicación** (`application/alerts/evaluate-alerts.ts`):
- `EvaluateAlerts` — recorre `listActive()`, matchea cada búsqueda contra
  `vigente_procedures`, detecta eventos por búsqueda, agrupa eventos por
  `user_id`, arma un digest por usuario, llama al cliente de email, y solo si
  el envío fue exitoso persiste los cambios de estado vía
  `SavedSearchMatchRepository`. Un fallo de envío para un usuario no debe
  frenar la evaluación de los demás (try/catch aislado por usuario dentro del
  loop).

**Presentación** (`presentation/routes/admin-saved-searches.ts`):
- CRUD protegido por `createRequireAdmin`, mismo shape que
  `admin-users.ts`: `GET/POST /`, `PATCH/DELETE /:id`. A diferencia de
  usuarios/API keys, aquí cada cuenta solo ve y administra **sus propias**
  búsquedas guardadas (`res.locals.currentUser.id`), porque son datos
  personales de seguimiento, no configuración compartida del equipo.
- `PATCH /api/admin/users/:id` (ya existente) se extiende para aceptar
  `email` opcional.

**Disparo**: en `vigente-cron.ts`, dentro de `child.on('close', ...)` cuando
`code === 0`, se llama `await evaluateAlerts.execute()` (inyectado igual que
las demás dependencias en `server.ts`).

## Frontend

- **Nueva página `/admin/alertas`** (mismo patrón que `AdminUsersPage`/
  `AdminApiKeysPage`): lista de búsquedas guardadas del usuario en sesión,
  formulario de creación (nombre + los filtros de vigentes), toggle
  activar/desactivar, eliminar.
- Nav link "Alertas" en `Layout.tsx`, junto a "Usuarios" y "API keys".
- Campo `email` agregado al formulario de creación/edición en
  `AdminUsersPage.tsx`.
- Si el usuario en sesión no tiene `email` configurado, `/admin/alertas`
  muestra un aviso arriba con link directo a `/admin/users` para
  configurarlo.

## Contenido del correo y manejo de errores

- Digest en texto plano + HTML simple, agrupado por tipo de evento; cada
  línea con nombre del procedimiento, dependencia, y link directo al detalle
  en el portal.
- Si Elastic Email falla (red, rate limit, etc.): se loguea el error y
  **no se marca nada como notificado** — el mismo evento se reintenta en la
  corrida del día siguiente. No hay reintento inmediato; el cron es diario,
  es margen suficiente.
- Un fallo de envío para un usuario no debe frenar la evaluación de los
  demás usuarios.

## Testing

- Unit tests para la lógica de detección de eventos en `EvaluateAlerts`
  (dado un estado de `saved_search_matches` + vigentes actuales, qué eventos
  produce), con repositorios en memoria — sin red ni DB real, como ya se hace
  con otros use cases del proyecto.
- Integration test de `admin-saved-searches.ts` contra la DB de test (mismo
  patrón que `api.integration.test.ts`).
- El cliente de Elastic Email se mockea en tests — nunca se manda correo real
  en la suite.

## Fuera de alcance (este documento)

- Score de oportunidad y análisis de bases con IA — se diseñan por separado.
- Alertas vía Slack u otro canal — solo email en este MVP.
- Umbral de "cierre próximo" configurable por búsqueda — fijo en 3 días.
- Digest programable (horario/frecuencia por usuario) — sigue el horario del
  cron del scraper.
