#!/usr/bin/env bash
# Browser test for Landing Page and Institutional Login against an isolated standalone build + SQLite seed.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

if [ ! -f .next/standalone/server.js ]; then
  echo 'Build ausente: executando `bun run build`...' >&2
  bun run build
fi

port="${LANDING_PORT:-3228}"
if curl -fsS -o /dev/null --max-time 2 "http://127.0.0.1:$port/" 2>/dev/null; then
  echo "Porta $port já está em uso; libere-a ou ajuste LANDING_PORT." >&2
  exit 2
fi

database="$(mktemp /tmp/edocbr-landing.XXXXXX.db)"
secret="$(head -c 32 /dev/urandom | base64 | tr -d '\n=')"
server_pid=''
server_log="$(mktemp /tmp/edocbr-landing-server.XXXXXX.log)"

cleanup() {
  [ -n "$server_pid" ] && kill "$server_pid" 2>/dev/null || true
  rm -f "$database" "$database-journal" "$database-wal" "$database-shm" "$server_log"
}
trap cleanup EXIT

echo "Provisionando banco temporário e executando seed..."
DATABASE_URL="file:$database" bunx prisma db push --skip-generate > /dev/null
DATABASE_URL="file:$database" bun prisma/seed.ts > /dev/null

echo "Iniciando servidor standalone na porta $port..."
DATABASE_URL="file:$database" \
  DEFAULT_TENANT_SLUG=camara-vila-nova \
  REALTIME_AUTH_SECRET="$secret" \
  LEGIS_DEMO_MODE=true \
  NODE_ENV=production PORT="$port" HOSTNAME=127.0.0.1 \
  bun .next/standalone/server.js > "$server_log" 2>&1 &
server_pid=$!

for _ in $(seq 1 60); do
  if ! kill -0 "$server_pid" 2>/dev/null; then
    echo 'A instância descartável encerrou ao iniciar:' >&2
    tail -20 "$server_log" >&2
    exit 1
  fi
  if curl -fsS -o /dev/null "http://127.0.0.1:$port/api/v1/bootstrap" 2>/dev/null; then break; fi
  sleep 1
done

curl -fsS -o /dev/null "http://127.0.0.1:$port/api/v1/bootstrap" || {
  echo "Instância descartável não respondeu na porta $port:" >&2
  tail -20 "$server_log" >&2
  exit 1
}

echo "Executando suíte Playwright da Landing Page..."
DATABASE_URL="file:$database" LANDING_BASE_URL="http://127.0.0.1:$port" bun scripts/local-landing-browser.mjs --base-url "http://127.0.0.1:$port"

