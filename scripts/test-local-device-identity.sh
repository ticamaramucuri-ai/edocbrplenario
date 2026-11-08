#!/usr/bin/env bash
set -euo pipefail
database="$(mktemp /tmp/edocbr-local-device.XXXXXX.db)"
trap 'rm -f "$database" "$database-journal" "$database-wal" "$database-shm"' EXIT
DATABASE_URL="file:$database" bunx prisma db push --skip-generate >/dev/null
DATABASE_URL="file:$database" bun test tests/local-device-identity.test.ts
