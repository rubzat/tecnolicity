#!/usr/bin/env bash
set -euo pipefail

echo "[entrypoint] running database migrations..."
pnpm exec tsx src/db/migrate.ts

echo "[entrypoint] starting server..."
exec pnpm exec tsx src/index.ts
