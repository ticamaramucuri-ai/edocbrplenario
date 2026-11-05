#!/usr/bin/env bash
# Banco+PDF+segmento+replay restaurados, servidos por build de produção descartável.
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."

if [[ ! -f .next/standalone/server.js ]]; then
  echo 'Build de produção ausente; execute bun run build.' >&2
  exit 2
fi
for bin in bun python3 ffmpeg curl cmp; do command -v "$bin" >/dev/null || { echo "$bin ausente" >&2; exit 2; }; done
port="${RESTORED_ACERVO_PORT:-3212}"
if curl -sS -o /dev/null --max-time 2 "http://127.0.0.1:$port/" 2>/dev/null; then
  echo "Porta $port ocupada; escolha RESTORED_ACERVO_PORT livre." >&2
  exit 2
fi
temporary="$(mktemp -d /tmp/edocbr-restored-acervo.XXXXXX)"
server_pid=''
cleanup() {
  if [[ -n "$server_pid" ]]; then kill "$server_pid" 2>/dev/null || true; wait "$server_pid" 2>/dev/null || true; fi
  rm -rf -- "$temporary"
}
trap cleanup EXIT

tenant='tenantacervo12345'
other='tenantoutro12345'
session='sessionacervo12345'
document='documentacervo12345'
password='EnsaioAcervo!2026'
mkdir -p "$temporary/images" "$temporary/public" "$temporary/recordings/session-$session" \
  "$temporary/replay/$tenant/$session"
touch "$temporary/source.db"
printf '%%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%%%EOF\n' > "$temporary/document.pdf"
ffmpeg -hide_banner -loglevel error -f lavfi -i 'testsrc2=size=160x90:rate=10' \
  -f lavfi -i 'sine=frequency=800:sample_rate=48000' -t 1 \
  -c:v libx264 -preset ultrafast -c:a aac -y "$temporary/replay/$tenant/$session/replay.mp4"
cp "$temporary/replay/$tenant/$session/replay.mp4" \
  "$temporary/recordings/session-$session/2026-11-05_15-00-00-000000.mp4"
DATABASE_URL="file:$temporary/source.db" bunx prisma db push --skip-generate >/dev/null
python3 - "$temporary/source.db" "$temporary/document.pdf" "$temporary/replay/$tenant/$session/replay.mp4" \
  "$temporary/recordings/session-$session/2026-11-05_15-00-00-000000.mp4" "$password" <<'PY'
import datetime
import hashlib
import json
import os
import sqlite3
import sys

database, pdf, replay, segment, password = sys.argv[1:]
now = datetime.datetime.now(datetime.timezone.utc).isoformat()
tenant, other, session, document = 'tenantacervo12345', 'tenantoutro12345', 'sessionacervo12345', 'documentacervo12345'
pdf_bytes = open(pdf, 'rb').read()
replay_bytes = open(replay, 'rb').read()
segment_bytes = open(segment, 'rb').read()
digest = lambda value: hashlib.sha256(value).hexdigest()
salt = os.urandom(16)
password_hash = f'scrypt${salt.hex()}${hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1, dklen=64).hex()}'
manifest = {'format': 1, 'sessionId': session, 'segments': [{
    'name': os.path.basename(segment), 'bytes': len(segment_bytes), 'sha256': digest(segment_bytes),
    'durationSeconds': 1, 'startedAt': '2026-11-05T15:00:00.000Z', 'codecs': ['h264', 'aac'],
}], 'totalDurationSeconds': 1, 'gapCount': 0}
manifest_json = json.dumps(manifest, separators=(',', ':'))
with sqlite3.connect(database) as db:
    for id_, slug in [(tenant, 'camara-acervo-restaurado'), (other, 'outra-camara-acervo')]:
        db.execute('INSERT INTO Tenant (id, slug, name, city, uf, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
                   (id_, slug, 'Câmara fictícia', 'Teste', 'BA', now))
    for id_, tenant_id, email in [('admin-acervo', tenant, 'admin-acervo@example.invalid'),
                                   ('admin-outro', other, 'admin-outro@example.invalid')]:
        db.execute('INSERT INTO User (id, tenantId, name, email, role, passwordHash, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
                   (id_, tenant_id, 'Admin fictício', email, 'tenant_admin', password_hash, now))
    db.execute('INSERT INTO Session (id, tenantId, number, year, scheduledAt, status, updatedAt) VALUES (?, ?, 1, 2026, ?, ?, ?)',
               (session, tenant, now, 'closed', now))
    db.execute('INSERT INTO SessionDocument (id, tenantId, sessionId, kind, version, name, mimeType, sizeBytes, sha256, content, createdById) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)',
               (document, tenant, session, 'pauta', 'pauta-ficticia.pdf', 'application/pdf', len(pdf_bytes), digest(pdf_bytes), pdf_bytes, 'admin-acervo'))
    db.execute('INSERT INTO SessionRecording (id, tenantId, sessionId, status, manifestJson, manifestSha256, replaySha256, replayBytes, durationSeconds, gapCount, publishedAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)',
               ('record-acervo', tenant, session, 'published', manifest_json, digest(manifest_json.encode()),
                digest(replay_bytes), len(replay_bytes), now, now))
PY

python3 scripts/backup-bundle.py create --database sqlite --sqlite-source "$temporary/source.db" \
  --output "$temporary/bundle" --images-root "$temporary/images" --public-root "$temporary/public" \
  --recordings-root "$temporary/recordings" --replay-root "$temporary/replay" >/dev/null
python3 scripts/backup-bundle.py restore-files --bundle "$temporary/bundle" \
  --target "$temporary/restored" >/dev/null

DATABASE_URL="file:$temporary/restored/database.sqlite" DEFAULT_TENANT_SLUG=camara-acervo-restaurado \
  MEDIA_RECORDINGS_ROOT="$temporary/restored/recordings" MEDIA_REPLAY_ROOT="$temporary/restored/replay" \
  NODE_ENV=production PORT="$port" HOSTNAME=127.0.0.1 \
  bun .next/standalone/server.js >"$temporary/server.log" 2>&1 &
server_pid=$!
for _ in $(seq 1 50); do
  if ! kill -0 "$server_pid" 2>/dev/null; then tail -25 "$temporary/server.log" >&2; exit 1; fi
  if curl -fsS -o /dev/null "http://127.0.0.1:$port/api/v1/health?ready=1" 2>/dev/null; then break; fi
  sleep 0.2
done
base="http://127.0.0.1:$port"
curl -fsS -o /dev/null "$base/api/v1/health?ready=1"
curl -fsS -c "$temporary/admin.cookie" -H 'Content-Type: application/json' \
  -d "{\"email\":\"admin-acervo@example.invalid\",\"password\":\"$password\"}" \
  "$base/api/v1/auth/login" -o /dev/null
curl -fsS -c "$temporary/other.cookie" -H 'Content-Type: application/json' \
  -d "{\"email\":\"admin-outro@example.invalid\",\"password\":\"$password\"}" \
  "$base/api/v1/auth/login" -o /dev/null
document_url="$base/api/v1/sessions/$session/documents/$document"
replay_url="$base/api/v1/public/sessions/$session/replay?tenant=camara-acervo-restaurado"
curl -fsS -b "$temporary/admin.cookie" "$document_url" -o "$temporary/http.pdf"
cmp "$temporary/http.pdf" "$temporary/document.pdf"
other_status="$(curl -sS -b "$temporary/other.cookie" -o /dev/null -w '%{http_code}' "$document_url")"
[[ "$other_status" == 403 || "$other_status" == 404 ]] || { echo "Documento atravessou Câmara: HTTP $other_status" >&2; exit 1; }
curl -fsS "$replay_url" -o "$temporary/http.mp4"
cmp "$temporary/http.mp4" "$temporary/restored/replay/$tenant/$session/replay.mp4"
range_status="$(curl -sS -H 'Range: bytes=0-31' -o "$temporary/range.bin" -w '%{http_code}' "$replay_url")"
[[ "$range_status" == 206 && "$(wc -c < "$temporary/range.bin")" == 32 ]] || { echo 'Range do replay inválido.' >&2; exit 1; }
[[ "$(curl -sS -o /dev/null -w '%{http_code}' "$base/api/v1/public/sessions/$session/replay?tenant=outra-camara-acervo")" == 404 ]]

# Alterar um byte no DB restaurado deve falhar no manifesto e no download.
python3 - "$temporary/restored/database.sqlite" "$document" <<'PY'
import sqlite3, sys
with sqlite3.connect(sys.argv[1]) as db:
    content = bytearray(db.execute('SELECT content FROM SessionDocument WHERE id=?', (sys.argv[2],)).fetchone()[0])
    content[6] = ord('X')
    db.execute('UPDATE SessionDocument SET content=? WHERE id=?', (bytes(content), sys.argv[2]))
PY
if python3 scripts/backup-bundle.py verify --bundle "$temporary/restored" >/dev/null 2>&1; then
  echo 'Manifesto aceitou documento adulterado.' >&2; exit 1
fi
[[ "$(curl -sS -b "$temporary/admin.cookie" -o /dev/null -w '%{http_code}' "$document_url")" == 409 ]] || {
  echo 'Download aceitou documento adulterado.' >&2; exit 1;
}
printf 'replay adulterado' > "$temporary/restored/replay/$tenant/$session/replay.mp4"
[[ "$(curl -sS -o /dev/null -w '%{http_code}' "$replay_url")" == 409 ]] || {
  echo 'Replay adulterado não foi recusado.' >&2; exit 1;
}
rm "$temporary/restored/replay/$tenant/$session/replay.mp4"
[[ "$(curl -sS -o /dev/null -w '%{http_code}' "$replay_url")" == 409 ]] || {
  echo 'Replay ausente não foi recusado.' >&2; exit 1;
}
echo 'Restauração local: PDF e replay íntegros via HTTP; isolamento por Câmara, Range, adulteração e ausência conferidos.'
