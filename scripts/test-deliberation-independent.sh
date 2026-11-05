#!/usr/bin/env bash
set -euo pipefail
database="$(mktemp /tmp/edocbr-deliberation-independent.XXXXXX.db)"
cleanup() { rm -f "$database" "$database-journal" "$database-wal" "$database-shm"; }
trap cleanup EXIT
DATABASE_URL="file:$database" bunx prisma db push --skip-generate > /dev/null
DATABASE_URL="file:$database" LEGIS_DEMO_MODE=true bun test tests/deliberation-independent.test.ts
