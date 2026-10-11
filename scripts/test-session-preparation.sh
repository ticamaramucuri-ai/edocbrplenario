#!/usr/bin/env bash
set -euo pipefail
database="$(mktemp /tmp/edocbr-session-preparation.XXXXXX.db)"
cleanup() { rm -f "$database" "$database-journal" "$database-wal" "$database-shm"; }
trap cleanup EXIT
DATABASE_URL="file:$database" bunx prisma db push --skip-generate > /dev/null
DATABASE_URL="file:$database" LEGIS_DEMO_MODE=true bun test tests/session-preparation.test.ts
DATABASE_URL="file:$database" LEGIS_DEMO_MODE=true bun test tests/session-policy.test.ts
DATABASE_URL="file:$database" LEGIS_DEMO_MODE=true bun test tests/agenda-amendments.test.ts
DATABASE_URL="file:$database" LEGIS_DEMO_MODE=true bun test tests/session-notice.test.ts
DATABASE_URL="file:$database" LEGIS_DEMO_MODE=true bun test tests/session-notice-ack.test.ts
DATABASE_URL="file:$database" LEGIS_DEMO_MODE=true bun test tests/session-notice-deadlines.test.ts
DATABASE_URL="file:$database" LEGIS_DEMO_MODE=true bun test tests/session-notice-calendar.test.ts
DATABASE_URL="file:$database" LEGIS_DEMO_MODE=true bun test tests/session-notice-alerts.test.ts
DATABASE_URL="file:$database" LEGIS_DEMO_MODE=true bun test tests/session-notice-recipient-policy.test.ts
