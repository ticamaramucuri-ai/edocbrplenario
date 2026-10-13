#!/usr/bin/env bash
set -euo pipefail
database="$(mktemp /tmp/edocbr-display-state.XXXXXX.db)"
trap 'rm -f "$database" "$database-journal" "$database-wal" "$database-shm"' EXIT
DATABASE_URL="file:$database" bunx prisma db push --skip-generate >/dev/null
DATABASE_URL="file:$database" LEGIS_DEMO_MODE=true bun test tests/display-state.test.ts tests/display-snapshot.test.ts
