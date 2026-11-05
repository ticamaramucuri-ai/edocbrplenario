#!/usr/bin/env bash
# Prova descartável: DB + foto restaurados são servidos pela aplicação de produção.
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."

if [ ! -f .next/standalone/server.js ]; then
  echo 'Build de produção ausente; execute bun run build.' >&2
  exit 2
fi
port="${RESTORED_IMAGE_PORT:-3211}"
if curl -sS -o /dev/null --max-time 2 "http://127.0.0.1:$port/" 2>/dev/null; then
  echo "Porta $port ocupada; escolha RESTORED_IMAGE_PORT livre." >&2
  exit 2
fi
temporary="$(mktemp -d /tmp/edocbr-restored-image.XXXXXX)"
server_pid=''
cleanup() {
  [ -n "$server_pid" ] && kill "$server_pid" 2>/dev/null || true
  rm -rf -- "$temporary"
}
trap cleanup EXIT

tenant='tenantrestore12345'
file='12345678-1234-4123-8123-123456789abc.webp'
mkdir -p "$temporary/images/$tenant" "$temporary/public"
touch "$temporary/source.db"
bun -e 'import sharp from "sharp"; await sharp({ create: { width: 4, height: 4, channels: 3, background: "#2863a0" } }).webp().toFile(process.argv[1])' \
  "$temporary/images/$tenant/$file"
DATABASE_URL="file:$temporary/source.db" bunx prisma db push --skip-generate >/dev/null
python3 - "$temporary/source.db" "$tenant" "$file" <<'PY'
import sqlite3
import sys

database, tenant, image = sys.argv[1:]
url = f'/api/v1/public/parliamentarian-images/{tenant}/{image}'
with sqlite3.connect(database) as db:
    db.execute("INSERT INTO Tenant (id, slug, name, city, uf, updatedAt) VALUES (?, 'camara-restaurada', 'Câmara de ensaio', 'Teste', 'BA', CURRENT_TIMESTAMP)", (tenant,))
    db.execute("INSERT INTO Parliamentarian (id, tenantId, name, party, photoUrl, updatedAt) VALUES ('member-restore-1', ?, 'Parlamentar de ensaio', 'SEM', ?, CURRENT_TIMESTAMP)", (tenant, url))
PY

python3 scripts/backup-bundle.py create --database sqlite --sqlite-source "$temporary/source.db" \
  --output "$temporary/bundle" --images-root "$temporary/images" --public-root "$temporary/public" >/dev/null
python3 scripts/backup-bundle.py restore-files --bundle "$temporary/bundle" --target "$temporary/restored" >/dev/null
python3 scripts/audit-parliamentarian-images.py --source "$temporary/restored/database.sqlite" \
  --root "$temporary/restored/images" --strict >/dev/null

DATABASE_URL="file:$temporary/restored/database.sqlite" DEFAULT_TENANT_SLUG=camara-restaurada \
  PARLIAMENTARIAN_IMAGES_ROOT="$temporary/restored/images" NODE_ENV=production \
  PORT="$port" HOSTNAME=127.0.0.1 bun .next/standalone/server.js >"$temporary/server.log" 2>&1 &
server_pid=$!
for _ in $(seq 1 50); do
  if ! kill -0 "$server_pid" 2>/dev/null; then
    tail -25 "$temporary/server.log" >&2
    exit 1
  fi
  if curl -fsS -o /dev/null "http://127.0.0.1:$port/api/v1/health?ready=1" 2>/dev/null; then break; fi
  sleep 0.2
done
curl -fsS -o /dev/null "http://127.0.0.1:$port/api/v1/health?ready=1"
image_url="http://127.0.0.1:$port/api/v1/public/parliamentarian-images/$tenant/$file"
curl -fsS "$image_url" -o "$temporary/http.webp"
cmp "$temporary/http.webp" "$temporary/restored/images/$tenant/$file"
test "$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/api/v1/public/parliamentarian-images/tenantother12345/$file")" = 404

cp "$temporary/restored/images/$tenant/$file" "$temporary/original.webp"
printf 'adulterado' > "$temporary/restored/images/$tenant/$file"
if python3 scripts/backup-bundle.py verify --bundle "$temporary/restored" >/dev/null 2>&1; then
  echo 'Manifesto aceitou imagem adulterada.' >&2
  exit 1
fi
mv "$temporary/original.webp" "$temporary/restored/images/$tenant/$file"
rm "$temporary/restored/images/$tenant/$file"
if python3 scripts/audit-parliamentarian-images.py --source "$temporary/restored/database.sqlite" \
  --root "$temporary/restored/images" --strict >/dev/null 2>&1; then
  echo 'Auditoria aceitou imagem ausente.' >&2
  exit 1
fi
echo 'Restauração local: DB pronto, imagem referenciada servida por HTTP com bytes idênticos; outro tenant 404; adulteração e ausência recusadas.'
