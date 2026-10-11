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
DATABASE_URL='postgresql://postgres:test-only@localhost:5432/postgres' bunx prisma migrate diff \
  --from-empty --to-schema-datamodel "$temporary/schema.prisma" --script > "$temporary/generated.sql"
if ! cmp -s "$temporary/generated.sql" prisma/postgres/migrations/0001_baseline.sql; then
  echo 'Baseline PostgreSQL divergiu do schema Prisma; regenere e revise 0001_baseline.sql.' >&2
  exit 1
fi
docker run -d --rm --name "$container" -p 127.0.0.1::5432 -e POSTGRES_PASSWORD=test-only postgres:16-alpine >/dev/null
for attempt in {1..30}; do
  if docker exec "$container" pg_isready -U postgres -d postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$container" pg_isready -U postgres -d postgres >/dev/null
docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U postgres -d postgres < prisma/postgres/migrations/0001_baseline.sql >/dev/null
docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U postgres -d postgres < prisma/postgres/migrations/0002_delivery_indexes.sql >/dev/null
docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -c \
  "INSERT INTO \"Tenant\" (id, slug, name, city, uf, \"updatedAt\") VALUES ('tenant-restore-proof', 'restore-proof', 'Ensaio', 'Teste', 'BA', now());" >/dev/null
docker exec "$container" pg_dump -U postgres -d postgres -Fc > "$temporary/backup.dump"
docker exec "$container" createdb -U postgres restored
docker exec -i "$container" pg_restore -e -U postgres -d restored < "$temporary/backup.dump" >/dev/null
restored="$(docker exec "$container" psql -At -U postgres -d restored -c "SELECT count(*) FROM \"Tenant\" WHERE slug='restore-proof'")"
test "$restored" = 1
indexes_before="$(docker exec "$container" psql -At -U postgres -d restored -c "SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexname IN ('OutboxEvent_pending_createdAt_id_idx','WebhookDelivery_pending_due_idx')")"
test "$indexes_before" = 2
docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U postgres -d restored < prisma/postgres/rollback/0002_delivery_indexes.sql >/dev/null
indexes_after="$(docker exec "$container" psql -At -U postgres -d restored -c "SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexname IN ('OutboxEvent_pending_createdAt_id_idx','WebhookDelivery_pending_due_idx')")"
test "$indexes_after" = 0
test "$(docker exec "$container" psql -At -U postgres -d restored -c "SELECT count(*) FROM \"Tenant\" WHERE slug='restore-proof'")" = 1
docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U postgres -d restored < prisma/postgres/migrations/0002_delivery_indexes.sql >/dev/null
test "$(docker exec "$container" psql -At -U postgres -d restored -c "SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexname IN ('OutboxEvent_pending_createdAt_id_idx','WebhookDelivery_pending_due_idx')")" = 2
tables="$(docker exec "$container" psql -At -U postgres -d restored -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")"
port="$(docker port "$container" 5432/tcp | sed 's/.*://')"
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
