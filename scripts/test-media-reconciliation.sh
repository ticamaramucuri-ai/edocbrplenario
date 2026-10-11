#!/usr/bin/env bash
set -euo pipefail
database="$(mktemp /tmp/legis-media-integration.XXXXXX.db)"
cleanup() { rm -f "$database" "$database-journal" "$database-wal" "$database-shm"; }
trap cleanup EXIT
DATABASE_URL="file:$database" bunx prisma db push --skip-generate > /dev/null
DATABASE_URL="file:$database" bun test tests/media-reconciliation.test.ts
DATABASE_URL="file:$database" bun test tests/media-path-lease.test.ts
