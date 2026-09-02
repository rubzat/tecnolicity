# Score de Oportunidad — diseño

**Fecha:** 2026-09-02
**Estado:** Aprobado para implementación

## Contexto

Segunda pieza del roadmap frente a ARGOS Inteligencia (ver comparación del
2026-09-01): un ranking calculado que le diga al usuario, de un vistazo,
qué tan buena es cada licitación vigente — sin tener que leerlas todas.
Es la pieza más barata de las tres del roadmap (alertas → **score** →
análisis de bases con IA) porque se calcula enteramente sobre datos que ya
existen en el sistema.

## Objetivo

Cada procedimiento "vigente" (actualmente abierto para licitar) muestra un
score de 0-100 en el portal, calculado a partir de señales de mercado
objetivas — no personalizado por usuario. El score responde: "¿vale la
pena invertir tiempo en esta licitación?"

## Decisiones de diseño

| Decisión | Elegido |
|---|---|
| Alcance | Global/objetivo — mismo score para cualquiera que vea el portal, no depende de búsquedas guardadas del usuario |
| Urgencia del cierre | **Fuera** del score — sigue como badge separado (ya existe); mezclar "qué tan buena" con "qué tan pronto cierra" penalizaría oportunidades excelentes solo por estar cerca de su fecha límite |
| Señales que combina | Monto estimado, nivel de competencia, riesgo de proveedor dominante |
| Modelo de cómputo | Precalculado por segmento (`tipo_contratación` + `siglas_dependencia`) una vez al día, cacheado — nunca se calcula en vivo por request |
| Datos insuficientes | Si un segmento tiene menos de 3 contratos históricos de respaldo, no se guarda score para él — el vigente correspondiente muestra "Sin datos suficientes" en vez de un número poco confiable |

## Arquitectura y flujo

Se engancha al mismo punto de disparo que ya usa `EvaluateAlerts`
(`onScrapeComplete`, tras el cron diario del scraper de vigentes) — no se
agrega un cron nuevo. Un caso de uso agrega los contratos históricos por
segmento, normaliza, y guarda una fila por segmento en una tabla de caché.
`GET /vigentes` hace un LEFT JOIN barato contra esa tabla al leer — nunca
agrega en vivo.

```
cron diario → scraper de vigentes → exit 0
                                        ↓
                      EvaluateAlerts.execute()  (ya existe)
                                        ↓
                      ComputeOpportunityScores.execute()  (nuevo)
                                        ↓
        agrupa contracts históricos por (tipo_contratación, siglas)
                                        ↓
        por segmento: monto mediano, # proveedores distintos, % del top
                                        ↓
        normaliza amount_score / competition_score contra TODOS los
        segmentos de esta corrida (min-max, una sola vez)
                                        ↓
        upsert de cada fila en opportunity_segment_stats
                                        ↓
GET /vigentes → LEFT JOIN por (tipo_contratación, siglas) → score + desglose
```

## Modelo de datos

### `opportunity_segment_stats` (nueva tabla)

```
id                       serial PK
tipo_contratacion        text NOT NULL
siglas_dependencia       text NOT NULL
sample_size              integer NOT NULL   -- # contratos históricos de respaldo
median_amount            numeric            -- monto mediano histórico del segmento
amount_score             integer NOT NULL   -- 0-100, normalizado contra todos los segmentos de esta corrida
distinct_suppliers       integer NOT NULL
competition_score        integer NOT NULL   -- 0-100 (menos proveedores = más alto)
dominant_supplier_share  numeric            -- % del proveedor top, para el desglose
is_dominated             boolean NOT NULL   -- true si un proveedor tiene ≥60% (mismo umbral que /market dominance)
computed_at               timestamptz NOT NULL

UNIQUE (tipo_contratacion, siglas_dependencia)
```

Se escribe vía **upsert por segmento** (`onConflictDoUpdate` sobre la
unique constraint), nunca truncate-then-insert — así un fallo a mitad de
la corrida deja los segmentos ya procesados en su valor más reciente en
vez de vaciar la tabla completa. Segmentos que dejan de calificar (caso
raro, ya que los datos históricos no encogen) simplemente no se
actualizan ese día — su fila queda con el `computed_at` de la última vez
que sí calificaron.

## Fórmula

Calculada **una vez por segmento en el job de agregación**, nunca en el
request de lectura:

```
score = round(0.6 × amount_score + 0.4 × competition_score)
if is_dominated: score = max(0, score - 30)
```

Pesos (0.6/0.4) y penalización (-30) son constantes nombradas en el
código, ajustables sin cambiar la arquitectura — no están escondidas
dentro de la lógica de agregación.

`amount_score` y `competition_score` se normalizan con min-max sobre
todos los segmentos calculados en esa misma corrida (no contra un rango
fijo arbitrario), así el score siempre refleja la distribución real del
mercado en el momento del cálculo.

## Componentes backend

Mismo patrón hexagonal ya establecido en el resto del proyecto:

- `domain/repositories/opportunity-score-repository.ts` — interfaz
  `OpportunityScoreRepository`: `computeRawSegmentAggregates()`,
  `upsertSegment(stats)`, `findBySegment(tipoContratacion, siglas)`.
- `infrastructure/db/repositories/opportunity-score-repository.ts` —
  implementación Drizzle. `computeRawSegmentAggregates()` reusa el mismo
  patrón de joins que ya usan `dominance()` y `competitors()` en
  `application/market/market-intelligence.ts` (mismo join
  contracts→procedures→purchasing_units→institutions/suppliers, agrupado
  por (`tipo_contratación`, `clave_institución`) en vez de por institución
  sola). Verificado manualmente contra Postgres real antes de escribir el
  plan de implementación.
- `application/opportunities/compute-opportunity-scores.ts` — caso de uso
  `ComputeOpportunityScores` + función pura `normalizeAndScore` (agrega,
  filtra por `sample_size < 3`, normaliza min-max, llama al calculador).
- `application/opportunities/opportunity-score-calculator.ts` — función
  pura (mismo patrón que `digest-builder.ts` de la feature de alertas):
  recibe `{amount_score, competition_score, is_dominated}` ya normalizados
  → `{ score }`.
- **Disparo**: se agrega como un paso más dentro del mismo callback
  `onScrapeComplete` ya wireado para `EvaluateAlerts` en
  `presentation/server.ts`.

## API

`GET /vigentes` (router existente, `presentation/routes/vigentes.ts` +
`DrizzleVigenteRepository.list`) se extiende con un LEFT JOIN contra
`opportunity_segment_stats` por (`tipo_contratacion`, `siglas_dependencia`).
Cada fila del payload gana:

```json
{
  "score": 78,
  "score_breakdown": {
    "amount_score": 82,
    "competition_score": 70,
    "is_dominated": false,
    "sample_size": 14
  }
}
```

`score`/`score_breakdown` son `null` cuando no hay fila de segmento
(datos insuficientes). El orden por defecto de la lista **no cambia**
(sigue siendo por fecha límite, más urgente primero); se agrega un
parámetro opcional `sort=score` (además del comportamiento actual) para
ordenar por score descendente sin romper el contrato existente.

## Frontend

`OpportunitiesPage.tsx` gana una columna "Score" en la tabla: badge 0-100
con color (alto/medio/bajo) o "Sin datos suficientes" cuando es `null`,
con un tooltip mostrando el desglose (monto/competencia/dominancia). Sin
página nueva — es una extensión de la vista que ya existe.

## Manejo de errores

Si `ComputeOpportunityScores` falla (error de DB, etc.), se loguea y se
omite esa corrida — los scores del día anterior quedan vigentes (gracias
al upsert-por-segmento, nunca hay una ventana con la tabla vacía). Un
fallo aquí nunca debe frenar `EvaluateAlerts` ni el resto del arranque
del servidor — se ejecuta en su propio try/catch dentro del callback
`onScrapeComplete`, igual que ya hace `EvaluateAlerts`.

## Testing

- Unit tests puros para `opportunity-score-calculator.ts`: caso normal,
  caso dominado (penalización aplicada), verificación de que el score
  queda clamped en [0, 100].
- Integration test de `DrizzleOpportunityScoreRepository.computeRawSegmentAggregates()`
  contra Postgres real, sembrando su propio dataset determinista (no el
  dataset histórico completo — el entorno de desarrollo local no lo
  tiene cargado). Las consultas SQL se verificaron manualmente antes de
  escribir el plan de implementación.
- Unit tests con fakes para la orquestación de `ComputeOpportunityScores`
  (normalización, filtro de muestra mínima, upsert por segmento
  calificado).
- Integration test de `GET /vigentes` confirmando que `score`/
  `score_breakdown` aparecen cuando hay datos, son `null` cuando no, y que
  `sort=score` ordena correctamente.

## Fuera de alcance (este documento)

- Análisis de bases con IA — se diseña por separado.
- Personalización del score por usuario/búsqueda guardada — explícitamente
  descartado en favor de un score global objetivo.
- Un cron o disparador propio — reusa el hook existente de alertas.
- Cambiar el orden por defecto de `/vigentes` — el sort por score es
  opt-in vía `sort=score`.

## Dependencia de rama

Este feature depende del hook `onScrapeComplete` y el composition root de
`EvaluateAlerts` en `presentation/server.ts`, agregados por la feature de
alertas (PR13) — que todavía no está mergeada a `main` al momento de
escribir este documento. Este feature se desarrolla en una rama apilada
sobre la rama de alertas (`worktree-alertas-por-email`), no sobre `main`
directamente.
