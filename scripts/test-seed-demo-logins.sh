#!/usr/bin/env bash
set -euo pipefail
database="$(mktemp /tmp/edocbr-seed-demo-logins.XXXXXX.db)"
cleanup() { rm -f "$database" "$database-journal" "$database-wal" "$database-shm"; }
trap cleanup EXIT
DATABASE_URL="file:$database" bunx prisma db push --skip-generate > /dev/null
DATABASE_URL="file:$database" bun prisma/seed.ts > /dev/null
DATABASE_URL="file:$database" bun test tests/seed-demo-logins.test.ts
