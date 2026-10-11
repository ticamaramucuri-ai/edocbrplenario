#!/usr/bin/env bash
# Ensaio local com snapshot consistente. Nunca altera o SQLite de origem.
set -euo pipefail
umask 077
source_db="${1:?Uso: bash scripts/test-postgres-pilot-replica.sh CAMINHO_SQLITE}"
test -f "$source_db" || { echo 'SQLite de origem não encontrado' >&2; exit 2; }
command -v docker >/dev/null
temporary="$(mktemp -d "$PWD/node_modules/.edocbr-pilot-replica.XXXXXX")"
container="edocbr-pg-pilot-$$"
switched_client=0
cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if [ "$switched_client" = 1 ]; then
    if ! DATABASE_URL='file:../db/custom.db' bunx prisma generate --schema prisma/schema.prisma >/dev/null; then
      echo 'Falha ao restaurar o cliente Prisma SQLite.' >&2
      status=1
    fi
    if [ -f "$temporary/next-env.d.ts" ]; then
      if ! cp "$temporary/next-env.d.ts" next-env.d.ts; then
        echo 'Falha ao restaurar next-env.d.ts.' >&2
        status=1
      fi
    fi
    if [ -f "$temporary/tsconfig.json" ]; then
      if ! cp "$temporary/tsconfig.json" tsconfig.json; then
        echo 'Falha ao restaurar tsconfig.json.' >&2
        status=1
      fi
    fi
  fi
  docker rm -f "$container" >/dev/null 2>&1 || true
  rm -rf -- "$temporary"
  exit "$status"
}
trap cleanup EXIT INT TERM
start_ms="$(date +%s%3N)"
python3 - "$source_db" "$temporary/source.db" <<'PY'
import sqlite3
import sys
from pathlib import Path

source = Path(sys.argv[1]).resolve()
with sqlite3.connect(source.as_uri() + '?mode=ro', uri=True) as live:
    with sqlite3.connect(sys.argv[2]) as snapshot:
        live.backup(snapshot)
with sqlite3.connect(sys.argv[2]) as snapshot:
    if snapshot.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
        raise SystemExit('snapshot SQLite inválido')
    if snapshot.execute('PRAGMA foreign_key_check').fetchone():
        raise SystemExit('snapshot SQLite com chaves estrangeiras inválidas')
    total = sum(snapshot.execute('SELECT count(*) FROM "' + name.replace('"', '""') + '"').fetchone()[0]
                for (name,) in snapshot.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"))
    print(f'Snapshot SQLite validado: {total} linhas.')
PY
snapshot_ms="$(($(date +%s%3N) - start_ms))"
asset_args=()
if [[ -n "${MEDIA_RECORDINGS_ROOT:-}" && -n "${MEDIA_REPLAY_ROOT:-}" ]]; then
  asset_args=(--recordings-root "$MEDIA_RECORDINGS_ROOT" --replay-root "$MEDIA_REPLAY_ROOT")
fi
python3 scripts/audit-external-assets.py --source "$temporary/source.db" --strict "${asset_args[@]}"
docker run -d --rm --name "$container" -p 127.0.0.1::5432 \
  -e POSTGRES_PASSWORD=replica-only postgres:16-alpine >/dev/null
for attempt in {1..30}; do
  if docker exec "$container" pg_isready -U postgres -d postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$container" pg_isready -U postgres -d postgres >/dev/null
port="$(docker port "$container" 5432/tcp | sed 's/.*://')"
url="postgresql://postgres:replica-only@127.0.0.1:$port/postgres"
POSTGRES_MIGRATION_URL="$url" python3 scripts/postgres-migrate.py apply
copy_start="$(date +%s%3N)"
POSTGRES_COPY_URL="$url" python3 scripts/postgres-copy.py --source "$temporary/source.db"
copy_ms="$(($(date +%s%3N) - copy_start))"
docker exec "$container" pg_dump -U postgres -d postgres -Fc > "$temporary/cutover.dump"
restore_start="$(date +%s%3N)"
docker exec "$container" createdb -U postgres cutoverproof
docker exec -i "$container" pg_restore -e -U postgres -d cutoverproof \
  < "$temporary/cutover.dump" >/dev/null
restore_ms="$(($(date +%s%3N) - restore_start))"
for table in Tenant Session Voting Vote MatterAttachment SessionRecording; do
  original_count="$(docker exec "$container" psql -At -U postgres -d postgres -c "SELECT count(*) FROM \"$table\"")"
  restored_count="$(docker exec "$container" psql -At -U postgres -d cutoverproof -c "SELECT count(*) FROM \"$table\"")"
  test "$original_count" = "$restored_count" || { echo "Restauração divergente em $table" >&2; exit 1; }
done
sed -e 's/provider = "sqlite"/provider = "postgresql"/' \
  -e "/provider = \"prisma-client-js\"/a\\  output = \"$temporary/client\"" \
  prisma/schema.prisma > "$temporary/schema.prisma"
DATABASE_URL="postgresql://postgres:replica-only@127.0.0.1:$port/cutoverproof" \
  bunx prisma generate --schema "$temporary/schema.prisma" >/dev/null
DATABASE_URL="postgresql://postgres:replica-only@127.0.0.1:$port/cutoverproof" \
  POSTGRES_TEST_CLIENT="$temporary/client" bun scripts/postgres-restored-smoke.ts
if [ "${EDOCBR_HTTP_REPLICA_SMOKE:-0}" = 1 ] || [ "${EDOCBR_PRODUCTION_REPLICA_SMOKE:-0}" = 1 ]; then
  python3 - <<'PY'
from pathlib import Path

root = Path.cwd().resolve()
for process in Path('/proc').iterdir():
    if not process.name.isdigit():
        continue
    try:
        command = (process / 'cmdline').read_bytes().replace(b'\0', b' ')
        cwd = (process / 'cwd').resolve()
    except (OSError, PermissionError):
        continue
    if cwd == root and (b'node_modules/next' in command or b'next-server' in command):
        raise SystemExit('Pare a instância Next deste projeto antes do ensaio HTTP (cliente Prisma é temporariamente regenerado).')
PY
  cp next-env.d.ts "$temporary/next-env.d.ts"
  cp tsconfig.json "$temporary/tsconfig.json"
  sed 's/provider = "sqlite"/provider = "postgresql"/' prisma/schema.prisma > "$temporary/schema-app.prisma"
  switched_client=1
  DATABASE_URL="postgresql://postgres:replica-only@127.0.0.1:$port/cutoverproof" \
    bunx prisma generate --schema "$temporary/schema-app.prisma" >/dev/null
  if [ "${EDOCBR_HTTP_REPLICA_SMOKE:-0}" = 1 ]; then
    DATABASE_URL="postgresql://postgres:replica-only@127.0.0.1:$port/cutoverproof" \
      POSTGRES_TEST_CLIENT="$temporary/client" LEGIS_DEMO_MODE=true \
      bun scripts/postgres-http-replica.ts
  fi
  if [ "${EDOCBR_PRODUCTION_REPLICA_SMOKE:-0}" = 1 ]; then
    build_relative="node_modules/$(basename "$temporary")/prod-build"
    if ! DATABASE_URL="postgresql://postgres:replica-only@127.0.0.1:$port/cutoverproof" \
      EDOCBR_NEXT_DIST_DIR="$build_relative" NEXT_TELEMETRY_DISABLED=1 \
      bunx next build > "$temporary/next-build.log" 2>&1; then
      tail -30 "$temporary/next-build.log" >&2
      exit 1
    fi
    DATABASE_URL="postgresql://postgres:replica-only@127.0.0.1:$port/cutoverproof" \
      POSTGRES_TEST_CLIENT="$temporary/client" LEGIS_DEMO_MODE=true \
      EDOCBR_STANDALONE_SERVER="$temporary/prod-build/standalone/server.js" \
      bun scripts/postgres-production-write.ts
    docker exec "$container" pg_dump -U postgres -d cutoverproof -Fc > "$temporary/postwrite.dump"
    recovery_start="$(date +%s%3N)"
    docker exec "$container" createdb -U postgres afterwrite
    docker exec -i "$container" pg_restore -e -U postgres -d afterwrite < "$temporary/postwrite.dump" >/dev/null
    test "$(docker exec "$container" psql -At -U postgres -d afterwrite -c "SELECT count(*) FROM \"Tenant\" WHERE slug LIKE 'pg-write-%'")" = 2
    test "$(docker exec "$container" psql -At -U postgres -d afterwrite -c "SELECT count(*) FROM \"Vote\" v JOIN \"Voting\" w ON w.id=v.\"votingId\" JOIN \"Session\" s ON s.id=w.\"sessionId\" JOIN \"Tenant\" t ON t.id=s.\"tenantId\" WHERE t.slug LIKE 'pg-write-%'")" = 1
    DATABASE_URL="postgresql://postgres:replica-only@127.0.0.1:$port/afterwrite" \
      POSTGRES_TEST_CLIENT="$temporary/client" \
      EDOCBR_STANDALONE_SERVER="$temporary/prod-build/standalone/server.js" \
      bun scripts/postgres-recovery-check.ts
    recovery_ms="$(($(date +%s%3N) - recovery_start))"
    docker exec "$container" createdb -U postgres rollbackproof
    docker exec -i "$container" pg_restore -e -U postgres -d rollbackproof < "$temporary/cutover.dump" >/dev/null
    test "$(docker exec "$container" psql -At -U postgres -d rollbackproof -c "SELECT count(*) FROM \"Tenant\" WHERE slug LIKE 'pg-write-%'")" = 0
    echo "Recuperação local (restaurar + HTTP pronto): ${recovery_ms}ms; duas Câmaras de ensaio e voto preservados. Backup pré-escrita perde a jornada nova, como esperado."
  fi
fi
python3 - "$temporary/source.db" <<'PY'
import sqlite3
import sys
from pathlib import Path
from urllib.parse import urlsplit

with sqlite3.connect(sys.argv[1]) as db:
    if db.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
        raise SystemExit('retorno ao snapshot SQLite falhou')
    counts = {table: db.execute('SELECT count(*) FROM "' + table + '"').fetchone()[0]
              for table in ('Tenant', 'Session', 'Voting', 'Vote', 'MatterAttachment', 'SessionRecording')}
    print('Leitura de retorno SQLite: ' + ', '.join(f'{table}={count}' for table, count in counts.items()))
    links = db.execute('SELECT url FROM "MatterAttachment" WHERE url IS NOT NULL').fetchall()
    recordings = db.execute('SELECT count(*) FROM "SessionRecording"').fetchone()[0]
    relative = [url for (url,) in links if url.startswith('/') and not url.startswith('//')]
    public_root = Path('public').resolve()
    public_files = 0
    for url in relative:
        target = (public_root / url.lstrip('/')).resolve()
        if target.is_relative_to(public_root) and target.is_file():
            public_files += 1
    remote = sum(urlsplit(url).scheme in ('http', 'https') for (url,) in links)
    print(f'Referências de anexo: total={len(links)}, relativas={len(relative)}, '
          f'arquivos public encontrados={public_files}, remotas={remote}; gravações={recordings}.')
PY
echo "Ensaio concluído: snapshot=${snapshot_ms}ms, cópia+conciliação=${copy_ms}ms, restauração=${restore_ms}ms; tabelas críticas restauradas e retorno SQLite lido."
