#!/usr/bin/env bash
set -euo pipefail
database="$(mktemp /tmp/edocbr-official-configuration.XXXXXX.db)"
trap 'rm -f "$database" "$database-journal" "$database-wal" "$database-shm"' EXIT
DATABASE_URL="file:$database" bunx prisma db push --skip-generate >/dev/null
DATABASE_URL="file:$database" LEGIS_DEMO_MODE=true bun test tests/official-configuration.test.ts
