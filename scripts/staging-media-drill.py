#!/usr/bin/env python3
"""Synthetic H.264/AAC recording, archive publication, and public range read."""
import hashlib
import http.cookiejar
import json
import os
from pathlib import Path
import subprocess
import tempfile
from urllib.request import HTTPCookieProcessor, Request, build_opener

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / 'deploy/staging/.env'
values = dict(line.split('=', 1) for line in CONFIG.read_text().splitlines()
              if '=' in line and not line.startswith('#'))
base = f"http://127.0.0.1:{values.get('STAGE_APP_PORT', '3100')}"
env = {**os.environ, 'PGHOST': '127.0.0.1', 'PGPORT': values['STAGE_DB_PORT'],
       'PGUSER': 'edocbr_stage', 'PGDATABASE': 'edocbr_stage',
       'PGPASSWORD': values['STAGE_DB_PASSWORD']}
opener = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))
SESSION_ID = 'stage-media-recovery'


def query(sql: str) -> str:
    result = subprocess.run(['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', sql],
                            cwd=ROOT, env=env, text=True, capture_output=True, check=True)
    return result.stdout.strip()


def call(path: str, payload=None, headers=None):
    body = None if payload is None else json.dumps(payload).encode()
    req = Request(base + path, body,
                  {**({'Content-Type': 'application/json'} if body else {}), **(headers or {})})
    with opener.open(req, timeout=30) as response:
        return response.status, response.headers, response.read()


if query('SELECT count(*) FROM "Tenant"') != '1':
    raise RuntimeError('Ensaio permitido somente na base sintética exclusiva.')
tenant_id = query("SELECT id FROM \"Tenant\" WHERE slug='staging-example'")
if not tenant_id or not tenant_id.isalnum():
    raise RuntimeError('Tenant sintético ausente.')
app = subprocess.run(['docker', 'compose', '--env-file', str(CONFIG), '-f',
                      str(ROOT / 'deploy/staging/compose.yaml'), 'ps', '-q', 'app'],
                     cwd=ROOT, text=True, capture_output=True, check=True).stdout.strip()
if not app:
    raise RuntimeError('Aplicação de homologação não iniciada.')
for binary in ('ffmpeg', 'ffprobe'):
    subprocess.run(['docker', 'exec', app, 'sh', '-c', f'command -v {binary}'],
                   stdout=subprocess.DEVNULL, check=True)

# Fixture dedicated to the synthetic environment. Real sessions are never updated.
query('INSERT INTO "Session" (id, "tenantId", number, year, type, "scheduledAt", '
      '"closedAt", status, official, notes, "createdAt", "updatedAt") '
      f"SELECT '{SESSION_ID}', '{tenant_id}', 9999, 2026, 'ordinaria', now(), now(), "
      "'closed', false, 'Ensaio sintético de recuperação de mídia', now(), now() "
      f"WHERE NOT EXISTS (SELECT 1 FROM \"Session\" WHERE id='{SESSION_ID}')")
if query(f"SELECT status FROM \"Session\" WHERE id='{SESSION_ID}'") != 'closed':
    raise RuntimeError('Sessão de prova não está encerrada.')
query('INSERT INTO "Transmission" (id, "tenantId", "sessionId", status, "endedAt", '
      '"createdAt", "updatedAt") '
      f"SELECT 'stage-transmission-recovery', '{tenant_id}', '{SESSION_ID}', 'ended', now(), now(), now() "
      f"WHERE NOT EXISTS (SELECT 1 FROM \"Transmission\" WHERE \"sessionId\"='{SESSION_ID}')")
if query(f"SELECT status FROM \"Transmission\" WHERE \"sessionId\"='{SESSION_ID}'") != 'ended':
    raise RuntimeError('Transmissão de prova não está encerrada.')

_, _, login_body = call('/api/v1/auth/login', {'email': 'stage-admin@example.invalid',
                                               'password': values['STAGE_ADMIN_PASSWORD']})
assert json.loads(login_body)['actor']['role'] == 'tenant_admin'

with tempfile.TemporaryDirectory(prefix='edocbr-stage-media-') as temporary:
    _, _, state_body = call(f'/api/v1/sessions/{SESSION_ID}/transmission/archive')
    state = json.loads(state_body)['recording']
    source_dir = f'/data/recordings/session-{SESSION_ID}'
    names = ('2026-10-11_12-00-00-000000.mp4', '2026-10-11_12-00-01-000000.mp4')
    if not state:
        sample = f'/tmp/edocbr-stage-media-{os.getpid()}.mp4'
        subprocess.run(['docker', 'exec', app, 'ffmpeg', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
                        '-i', 'testsrc2=size=160x90:rate=10', '-f', 'lavfi',
                        '-i', 'sine=frequency=800:sample_rate=48000', '-t', '1',
                        '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac',
                        '-y', sample], check=True, timeout=20)
        try:
            subprocess.run(['docker', 'exec', app, 'mkdir', '-p', '-m', '700', source_dir], check=True)
            for name in names:
                subprocess.run(['docker', 'exec', app, 'cp', sample, f'{source_dir}/{name}'], check=True)
        finally:
            subprocess.run(['docker', 'exec', app, 'rm', '-f', sample],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        _, _, build_body = call(f'/api/v1/sessions/{SESSION_ID}/transmission/archive',
                                {'action': 'build', 'version': 1,
                                 'idempotencyKey': 'stage-media-recovery-build-v1'})
        state = json.loads(build_body)['recording']
    if state['status'] != 'published':
        _, _, publish_body = call(f'/api/v1/sessions/{SESSION_ID}/transmission/archive',
                                  {'action': 'publish', 'version': state['version'],
                                   'idempotencyKey': f'stage-media-recovery-publish-v{state["version"]}'})
        state = json.loads(publish_body)['recording']
    if state['status'] != 'published':
        raise RuntimeError('Replay não foi publicado.')
    _, _, verify_body = call(f'/api/v1/sessions/{SESSION_ID}/transmission/archive?verify=1')
    if json.loads(verify_body)['integrity'] != 'valid':
        raise RuntimeError('Integridade da gravação não foi confirmada pela aplicação.')
    status, headers, part = call(f'/api/v1/public/sessions/{SESSION_ID}/replay?tenant=staging-example',
                                 headers={'Range': 'bytes=0-31'})
    if status != 206 or len(part) != 32 or not headers.get('Content-Range', '').startswith('bytes 0-31/'):
        raise RuntimeError('Resposta pública Range inválida.')
    source_sha = state['segments'][0]['sha256']

print(json.dumps({'ok': True, 'synthetic': True, 'sessionId': SESSION_ID,
                  'segmentCount': len(names), 'segmentSha256': source_sha,
                  'replaySha256': state['replaySha256'],
                  'replayBytes': int(state['replayBytes']),
                  'archiveIntegrity': 'valid', 'publicRangeStatus': 206}, sort_keys=True))
