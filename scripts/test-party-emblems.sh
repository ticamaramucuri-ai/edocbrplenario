#!/usr/bin/env bash
set -euo pipefail
temporary="$(mktemp -d "$PWD/node_modules/.edocbr-party-test.XXXXXX")"
trap 'rm -rf "$temporary"' EXIT
export DATABASE_URL="file:$temporary/test.db"
export LEGIS_DEMO_MODE=true
: > "$temporary/test.db"
bunx prisma db push --skip-generate >/dev/null
bun test tests/party-emblems.test.ts
