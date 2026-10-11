#!/usr/bin/env bash
# Prova isolada de DDL e backup/restore; a aplicação ainda usa SQLite.
set -euo pipefail
command -v docker >/dev/null || { echo 'Docker necessário para o ensaio PostgreSQL' >&2; exit 2; }
container="edocbr-pg-foundation-$$"
temporary="$(mktemp -d "$PWD/node_modules/.edocbr-postgres-foundation.XXXXXX")"
switched_client=0
cleanup() {
  local status=$?
  trap - EXIT
  if [ "$switched_client" = 1 ]; then
    if ! DATABASE_URL='file:../db/custom.db' bunx prisma generate --schema prisma/schema.prisma >/dev/null; then
      echo 'Falha ao restaurar o cliente Prisma SQLite local.' >&2
      status=1
    fi
  fi
  docker rm -f "$container" >/dev/null 2>&1 || true
  rm -rf "$temporary"
  exit "$status"
}
trap cleanup EXIT
sed -e 's/provider = "sqlite"/provider = "postgresql"/' \
  -e "/provider = \"prisma-client-js\"/a\\  output = \"$temporary/client\"" \
  prisma/schema.prisma > "$temporary/schema.prisma"
DATABASE_URL='postgresql://postgres:test-only@localhost:5432/postgres' bunx prisma validate --schema "$temporary/schema.prisma" >/dev/null
sed -e '/partyEmblemUrl String?/d' -e '/emblemUrl String?/d' "$temporary/schema.prisma" > "$temporary/schema-baseline.prisma"
DATABASE_URL='postgresql://postgres:test-only@localhost:5432/postgres' bunx prisma migrate diff \
  --from-empty --to-schema-datamodel "$temporary/schema-baseline.prisma" --script > "$temporary/generated.sql"
if ! cmp -s "$temporary/generated.sql" prisma/postgres/migrations/0001_baseline.sql; then
  echo 'Baseline PostgreSQL histórico divergiu do schema anterior à migração 0003.' >&2
  exit 1
fi
docker run -d --rm --name "$container" -p 127.0.0.1::5432 -e POSTGRES_PASSWORD=test-only postgres:16-alpine >/dev/null
for attempt in {1..30}; do
  if docker exec "$container" pg_isready -U postgres -d postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$container" pg_isready -U postgres -d postgres >/dev/null
port="$(docker port "$container" 5432/tcp | sed 's/.*://')"
POSTGRES_MIGRATION_URL="postgresql://postgres:test-only@127.0.0.1:$port/postgres" python3 scripts/postgres-migrate.py status
POSTGRES_MIGRATION_URL="postgresql://postgres:test-only@127.0.0.1:$port/postgres" python3 scripts/postgres-migrate.py apply
POSTGRES_MIGRATION_URL="postgresql://postgres:test-only@127.0.0.1:$port/postgres" python3 scripts/postgres-migrate.py apply
docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -c \
  "INSERT INTO \"Tenant\" (id, slug, name, city, uf, \"updatedAt\") VALUES ('tenant-restore-proof', 'restore-proof', 'Ensaio', 'Teste', 'BA', now());" >/dev/null
docker exec "$container" pg_dump -U postgres -d postgres -Fc > "$temporary/backup.dump"
docker exec "$container" createdb -U postgres restored
docker exec -i "$container" pg_restore -e -U postgres -d restored < "$temporary/backup.dump" >/dev/null
restored="$(docker exec "$container" psql -At -U postgres -d restored -c "SELECT count(*) FROM \"Tenant\" WHERE slug='restore-proof'")"
test "$restored" = 1
indexes_before="$(docker exec "$container" psql -At -U postgres -d restored -c "SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexname IN ('OutboxEvent_pending_createdAt_id_idx','WebhookDelivery_pending_due_idx')")"
test "$indexes_before" = 2
POSTGRES_MIGRATION_URL="postgresql://postgres:test-only@127.0.0.1:$port/restored" python3 scripts/postgres-migrate.py rollback-indexes
indexes_after="$(docker exec "$container" psql -At -U postgres -d restored -c "SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexname IN ('OutboxEvent_pending_createdAt_id_idx','WebhookDelivery_pending_due_idx')")"
test "$indexes_after" = 0
test "$(docker exec "$container" psql -At -U postgres -d restored -c "SELECT count(*) FROM \"Tenant\" WHERE slug='restore-proof'")" = 1
POSTGRES_MIGRATION_URL="postgresql://postgres:test-only@127.0.0.1:$port/restored" python3 scripts/postgres-migrate.py apply
test "$(docker exec "$container" psql -At -U postgres -d restored -c "SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexname IN ('OutboxEvent_pending_createdAt_id_idx','WebhookDelivery_pending_due_idx')")" = 2
: > "$temporary/source.db"
DATABASE_URL="file:$temporary/source.db" bunx prisma db push --skip-generate >/dev/null
python3 scripts/create-postgres-copy-fixture.py "$temporary/source.db"
docker exec "$container" createdb -U postgres copyproof
POSTGRES_MIGRATION_URL="postgresql://postgres:test-only@127.0.0.1:$port/copyproof" python3 scripts/postgres-migrate.py apply
POSTGRES_COPY_URL="postgresql://postgres:test-only@127.0.0.1:$port/copyproof" \
  python3 scripts/postgres-copy.py --source "$temporary/source.db"
test "$(docker exec "$container" psql -At -U postgres -d copyproof -c 'SELECT count(*) FROM "Tenant"')" = 2
test "$(docker exec "$container" psql -At -U postgres -d copyproof -c 'SELECT count(*) FROM "AuditEvent"')" = 2
if POSTGRES_COPY_URL="postgresql://postgres:test-only@127.0.0.1:$port/copyproof" \
  python3 scripts/postgres-copy.py --source "$temporary/source.db" > "$temporary/repeat.log" 2>&1; then
  echo 'A cópia aceitou destino não vazio.' >&2
  exit 1
fi
cp "$temporary/source.db" "$temporary/source-bad.db"
sqlite3 "$temporary/source-bad.db" \
  "INSERT INTO \"Session\" (id, tenantId, number, year, scheduledAt, updatedAt) VALUES ('orphan', 'missing-tenant', 2, 2026, 0, 0);"
docker exec "$container" createdb -U postgres copybad
POSTGRES_MIGRATION_URL="postgresql://postgres:test-only@127.0.0.1:$port/copybad" python3 scripts/postgres-migrate.py apply
if POSTGRES_COPY_URL="postgresql://postgres:test-only@127.0.0.1:$port/copybad" \
  python3 scripts/postgres-copy.py --source "$temporary/source-bad.db" > "$temporary/bad-copy.log" 2>&1; then
  echo 'A cópia aceitou referência inválida.' >&2
  exit 1
fi
test "$(docker exec "$container" psql -At -U postgres -d copybad -c 'SELECT count(*) FROM "Tenant"')" = 0
test "$(docker exec "$container" psql -At -U postgres -d copybad -c 'SELECT count(*) FROM "Session"')" = 0
docker exec "$container" createdb -U postgres blocked
docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d blocked -c 'CREATE TABLE "Tenant" (id text PRIMARY KEY)' >/dev/null
if POSTGRES_MIGRATION_URL="postgresql://postgres:test-only@127.0.0.1:$port/blocked" \
  python3 scripts/postgres-migrate.py apply > "$temporary/blocked.log" 2>&1; then
  echo 'O baseline aceitou banco não vazio.' >&2
  exit 1
fi
test "$(docker exec "$container" psql -At -U postgres -d blocked -c 'SELECT count(*) FROM "_edocbr_schema_migration"')" = 0
tables="$(docker exec "$container" psql -At -U postgres -d restored -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name <> '_edocbr_schema_migration'")"
DATABASE_URL="postgresql://postgres:test-only@127.0.0.1:$port/postgres" bunx prisma generate --schema "$temporary/schema.prisma" >/dev/null
DATABASE_URL="postgresql://postgres:test-only@127.0.0.1:$port/postgres" \
  POSTGRES_TEST_CLIENT="$temporary/client" bun test tests/tenant-health-postgres.test.ts
DATABASE_URL="postgresql://postgres:test-only@127.0.0.1:$port/postgres" \
  POSTGRES_TEST_CLIENT="$temporary/client" bun test tests/realtime-outbox-postgres.test.ts
DATABASE_URL="postgresql://postgres:test-only@127.0.0.1:$port/postgres" \
  POSTGRES_TEST_CLIENT="$temporary/client" bun test tests/webhook-delivery-postgres.test.ts
DATABASE_URL="postgresql://postgres:test-only@127.0.0.1:$port/postgres" \
  POSTGRES_TEST_CLIENT="$temporary/client" bun test tests/scheduler-postgres.test.ts
bun test tests/webhook-http-delivery.test.ts
sed 's/provider = "sqlite"/provider = "postgresql"/' prisma/schema.prisma > "$temporary/schema-app.prisma"
switched_client=1
DATABASE_URL="postgresql://postgres:test-only@127.0.0.1:$port/postgres" bunx prisma generate --schema "$temporary/schema-app.prisma" >/dev/null
DATABASE_URL="postgresql://postgres:test-only@127.0.0.1:$port/postgres" \
  bun test tests/postgres-services-e2e.test.ts
DATABASE_URL="postgresql://postgres:test-only@127.0.0.1:$port/postgres" \
  bun test tests/scheduler-postgres-http.test.ts
DATABASE_URL="postgresql://postgres:test-only@127.0.0.1:$port/postgres" LEGIS_DEMO_MODE=true \
  bun test tests/session-notice-alerts.test.ts
DATABASE_URL="postgresql://postgres:test-only@127.0.0.1:$port/postgres" LEGIS_DEMO_MODE=true \
  bun test tests/session-journey.test.ts
DATABASE_URL="postgresql://postgres:test-only@127.0.0.1:$port/postgres" LEGIS_DEMO_MODE=true \
  bun test tests/session-readiness.test.ts
DATABASE_URL="postgresql://postgres:test-only@127.0.0.1:$port/postgres" LEGIS_DEMO_MODE=true \
  bun test tests/session-capacity.test.ts
echo "PostgreSQL: DDL aplicado, backup/restauração comprovados; $tables tabelas, 1 tenant restaurado."
