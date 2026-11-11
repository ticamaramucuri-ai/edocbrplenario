#!/usr/bin/env bash
# Parliamentary mobile self check-in, voting and receipt in an isolated build.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

if [ ! -f .next/standalone/server.js ]; then
  echo 'Build ausente: rode `bun run build` antes da jornada PWA.' >&2
  exit 2
fi

port="${PWA_VOTE_PORT:-3222}"
if curl -fsS -o /dev/null --max-time 2 "http://127.0.0.1:$port/" 2>/dev/null; then
  echo "Porta $port já está em uso; libere-a ou ajuste PWA_VOTE_PORT." >&2
  exit 2
fi

database="$(mktemp /tmp/edocbr-pwa-vote.XXXXXX.db)"
secret="$(head -c 32 /dev/urandom | base64 | tr -d '\n=')"
server_pid=''
server_log="$(mktemp /tmp/edocbr-pwa-vote-server.XXXXXX.log)"
cleanup() {
  [ -n "$server_pid" ] && kill "$server_pid" 2>/dev/null || true
  rm -f "$database" "$database-journal" "$database-wal" "$database-shm" "$server_log"
}
trap cleanup EXIT

DATABASE_URL="file:$database" bunx prisma db push --skip-generate > /dev/null
DATABASE_URL="file:$database" bun prisma/seed.ts > /dev/null
DATABASE_URL="file:$database" DEFAULT_TENANT_SLUG=camara-vila-nova REALTIME_AUTH_SECRET="$secret" \
  NODE_ENV=production PORT="$port" HOSTNAME=127.0.0.1 bun .next/standalone/server.js > "$server_log" 2>&1 &
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

PWA_VOTE_BASE_URL="http://127.0.0.1:$port" bun scripts/local-pwa-vote-browser.mjs
