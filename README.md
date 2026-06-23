# Tecnolicity — Portal de Licitaciones

Public procurement transparency portal for Mexican government tenders (ComprasMX / Compranet).

## Status

Scaffold + database schema only (PR 1 of a stacked-to-main chain). Ingestion, query API, analytics,
document fetching, and frontend are later PRs.

## Monorepo layout

```
tecnolicity/
├── apps/
│   ├── backend/          Express + TypeScript API (Clean/Hexagonal layers)
│   └── frontend/         React + Vite SPA
├── packages/
│   └── shared/           Zod schemas, enums, constants (shared FE + BE)
├── data/                 Source CSV + Excel files (gitignored — large)
├── docker-compose.yml    PostgreSQL 16 + pgvector
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── package.json
```

## Prerequisites

- Node.js 25+ (see `.nvmrc`)
- pnpm 9+ (`corepack enable`)
- Docker (for PostgreSQL)

## Quick start

```bash
# Install dependencies
pnpm install

# Copy env and start Postgres
cp .env.example .env
docker compose up -d

# Run database migrations
pnpm db:migrate

# Verify schema (connects + lists tables)
pnpm db:verify

# Start the backend dev server
pnpm dev
```

## Useful commands

| Command | What it does |
|---------|-------------|
| `pnpm typecheck` | TypeScript check across all workspaces |
| `pnpm test` | Run Vitest across all workspaces |
| `pnpm lint` | ESLint flat config |
| `pnpm format` | Prettier write |
| `pnpm db:generate` | Generate Drizzle migration from schema changes |
| `pnpm db:migrate` | Apply pending migrations to Postgres |
| `pnpm db:verify` | Connect + confirm tables + pgvector extension |

## Data model

8 normalized entities (see `apps/backend/src/db/schema/`):

`institutions` → `purchasing_units` → `procedures` ← `expedientes`
                                          ↓
                       `contracts` → `contract_amounts`
                          ↓
                       `suppliers`
                                          ↓
                                    `documents`

`procedures.embedding vector(1536)` is created but unpopulated (future semantic-search phase).
