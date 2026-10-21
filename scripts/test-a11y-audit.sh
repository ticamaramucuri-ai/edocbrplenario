#!/usr/bin/env bash
# Auditoria de acessibilidade de presença, votação, telão e app do parlamentar
# contra uma instância descartável: SQLite temporário, seed de demonstração e o
# build de produção servido em porta própria. Não toca a base de desenvolvimento.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

if [ ! -f .next/standalone/server.js ]; then
  echo 'Build ausente: rode `bun run build` antes da auditoria.' >&2
  exit 2
fi

port="${A11Y_PORT:-3210}"
# Porta ocupada significaria auditar outra instância — outro build, outro banco —
# e assinar o JSON de prova com medição do alvo errado.
if curl -fsS -o /dev/null --max-time 2 "http://127.0.0.1:$port/" 2>/dev/null; then
  echo "Porta $port já está em uso; libere-a ou ajuste A11Y_PORT." >&2
  exit 2
fi
database="$(mktemp /tmp/edocbr-a11y.XXXXXX.db)"
# Segredo efêmero: a instância é descartável e o serviço de tempo real não
# sobe aqui; nada de valor fixo em arquivo versionado.
secret="$(head -c 32 /dev/urandom | base64 | tr -d '\n=')"
server_pid=''
server_log="$(mktemp /tmp/edocbr-a11y-server.XXXXXX.log)"

cleanup() {
  [ -n "$server_pid" ] && kill "$server_pid" 2>/dev/null || true
  rm -f "$database" "$database-journal" "$database-wal" "$database-shm" "$server_log"
}
trap cleanup EXIT

DATABASE_URL="file:$database" bunx prisma db push --skip-generate > /dev/null
DATABASE_URL="file:$database" bun prisma/seed.ts > /dev/null

DATABASE_URL="file:$database" \
  DEFAULT_TENANT_SLUG=camara-vila-nova \
  REALTIME_AUTH_SECRET="${REALTIME_AUTH_SECRET:-$secret}" \
  NODE_ENV=production PORT="$port" HOSTNAME=127.0.0.1 \
  bun .next/standalone/server.js > "$server_log" 2>&1 &
server_pid=$!

for _ in $(seq 1 60); do
  if ! kill -0 "$server_pid" 2>/dev/null; then
    echo 'A instância descartável morreu ao subir:' >&2
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

bun scripts/staging-a11y-audit.mjs --base-url "http://127.0.0.1:$port"
