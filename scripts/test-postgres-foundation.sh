#!/usr/bin/env bash
# Prova isolada de DDL e backup/restore; a aplicação ainda usa SQLite.
set -euo pipefail
command -v docker >/dev/null || { echo 'Docker necessário para o ensaio PostgreSQL' >&2; exit 2; }
container="edocbr-pg-foundation-$$"
temporary="$(mktemp -d "$PWD/node_modules/.edocbr-postgres-foundation.XXXXXX")"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; rm -rf "$temporary"; }
trap cleanup EXIT
sed -e 's/provider = "sqlite"/provider = "postgresql"/' \
  -e "/provider = \"prisma-client-js\"/a\\  output = \"$temporary/client\"" \
  prisma/schema.prisma > "$temporary/schema.prisma"
DATABASE_URL='postgresql://postgres:test-only@localhost:5432/postgres' bunx prisma validate --schema "$temporary/schema.prisma" >/dev/null
DATABASE_URL='postgresql://postgres:test-only@localhost:5432/postgres' bunx prisma migrate diff \
  --from-empty --to-schema-datamodel "$temporary/schema.prisma" --script > "$temporary/initial.sql"
docker run -d --rm --name "$container" -p 127.0.0.1::5432 -e POSTGRES_PASSWORD=test-only postgres:16-alpine >/dev/null
for attempt in {1..30}; do
  if docker exec "$container" pg_isready -U postgres -d postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$container" pg_isready -U postgres -d postgres >/dev/null
docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U postgres -d postgres < "$temporary/initial.sql" >/dev/null
docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -c \
  "INSERT INTO \"Tenant\" (id, slug, name, city, uf, \"updatedAt\") VALUES ('tenant-restore-proof', 'restore-proof', 'Ensaio', 'Teste', 'BA', now());" >/dev/null
docker exec "$container" pg_dump -U postgres -d postgres -Fc > "$temporary/backup.dump"
docker exec "$container" createdb -U postgres restored
docker exec -i "$container" pg_restore -e -U postgres -d restored < "$temporary/backup.dump" >/dev/null
restored="$(docker exec "$container" psql -At -U postgres -d restored -c "SELECT count(*) FROM \"Tenant\" WHERE slug='restore-proof'")"
test "$restored" = 1
tables="$(docker exec "$container" psql -At -U postgres -d restored -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")"
port="$(docker port "$container" 5432/tcp | sed 's/.*://')"
DATABASE_URL="postgresql://postgres:test-only@127.0.0.1:$port/postgres" bunx prisma generate --schema "$temporary/schema.prisma" >/dev/null
DATABASE_URL="postgresql://postgres:test-only@127.0.0.1:$port/postgres" \
  POSTGRES_TEST_CLIENT="$temporary/client" bun test tests/tenant-health-postgres.test.ts
echo "PostgreSQL: DDL aplicado, backup/restauração comprovados; $tables tabelas, 1 tenant restaurado."
