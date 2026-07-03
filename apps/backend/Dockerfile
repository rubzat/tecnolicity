# Backend runtime image.
#
# Runs the backend via `tsx` (no `tsc` compile step) because the workspace's
# `@tecnolicity/shared` package resolves its `main`/`exports` to raw
# TypeScript (`./src/index.ts`) rather than compiled JS — plain `node
# dist/index.js` cannot import it (Node's ESM loader can't execute .ts
# files). `tsx` transpiles on import, exactly like `pnpm dev` already does,
# so this reuses a code path that's proven to work rather than patching
# workspace package.json resolution just for the image.
#
# Base image ships Node + the exact Chromium build `playwright` expects
# (matched by version tag below), so the vigente scraper and document
# fetcher work out of the box — no `playwright install` step needed.
FROM mcr.microsoft.com/playwright:v1.61.1-noble

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

WORKDIR /app

# Manifests first for better layer caching — only re-runs `pnpm install`
# when a package.json or the lockfile actually changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/frontend/package.json apps/frontend/package.json
COPY packages/shared/package.json packages/shared/package.json

# Installs devDependencies too (tsx/typescript are required at runtime here) —
# must run before NODE_ENV=production is set, or pnpm skips them.
RUN pnpm install --frozen-lockfile

COPY packages/shared packages/shared
COPY apps/backend apps/backend

ENV NODE_ENV=production
WORKDIR /app/apps/backend

RUN chmod +x ./docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
