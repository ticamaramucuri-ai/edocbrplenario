#!/usr/bin/env python3
"""Temporarily hide a synthetic published replay and verify fail-closed/recovery."""
import json
import os
from pathlib import Path
import subprocess
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / 'deploy/staging/.env'
COMPOSE = ROOT / 'deploy/staging/compose.yaml'
values = dict(line.split('=', 1) for line in CONFIG.read_text().splitlines()
              if '=' in line and not line.startswith('#'))
env = {**os.environ, 'PGHOST': '127.0.0.1', 'PGPORT': values.get('STAGE_DB_PORT', '55432'),
       'PGUSER': 'edocbr_stage', 'PGDATABASE': 'edocbr_stage',
       'PGPASSWORD': values['STAGE_DB_PASSWORD']}
base = f"http://127.0.0.1:{values.get('STAGE_APP_PORT', '3100')}"


def query(sql):
    return subprocess.run(['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', sql],
                          cwd=ROOT, env=env, text=True, capture_output=True, check=True).stdout.strip()


def read():
    request = Request(base + '/api/v1/public/sessions/stage-media-recovery/replay?tenant=staging-example',
                      headers={'Range': 'bytes=0-31'})
    try:
        with urlopen(request, timeout=10) as response:
            return response.status, response.read()
    except HTTPError as error:
        return error.code, error.read()


if query('SELECT count(*) FROM "Tenant"') != '1':
    raise RuntimeError('Ensaio permitido somente na base sintética exclusiva.')
tenant_id = query("SELECT id FROM \"Tenant\" WHERE slug='staging-example'")
if not tenant_id or not tenant_id.isalnum():
    raise RuntimeError('Tenant sintético ausente.')
stored = query("SELECT status || '|' || \"replaySha256\" FROM \"SessionRecording\" "
               "WHERE \"sessionId\"='stage-media-recovery'")
if not stored.startswith('published|'):
    raise RuntimeError('Replay sintético publicado ausente.')
expected_hash = stored.split('|', 1)[1]
container = subprocess.run(['docker', 'compose', '--env-file', str(CONFIG), '-f', str(COMPOSE),
                            'ps', '-q', 'app'], cwd=ROOT, text=True, capture_output=True,
                           check=True).stdout.strip()
if not container:
    raise RuntimeError('Aplicação de homologação inativa.')
source = f'/data/replay/{tenant_id}/stage-media-recovery/replay.mp4'
hidden = source + '.stage-fault'
subprocess.run(['docker', 'exec', container, 'test', '!', '-e', hidden], check=True)
hash_before = subprocess.run(['docker', 'exec', container, 'sha256sum', source],
                             check=True, text=True, capture_output=True).stdout.split()[0]
if hash_before != expected_hash or read()[0] != 206:
    raise RuntimeError('Replay não estava íntegro antes da falha.')
hidden_now = False
try:
    subprocess.run(['docker', 'exec', container, 'mv', source, hidden], check=True)
    hidden_now = True
    missing_status, _ = read()
    if missing_status != 409:
        raise RuntimeError(f'Arquivo ausente retornou HTTP {missing_status}; esperado 409.')
finally:
    if hidden_now:
        subprocess.run(['docker', 'exec', container, 'mv', hidden, source], check=True)
recovered_status, part = read()
hash_after = subprocess.run(['docker', 'exec', container, 'sha256sum', source],
                            check=True, text=True, capture_output=True).stdout.split()[0]
if recovered_status != 206 or len(part) != 32 or hash_after != expected_hash:
    raise RuntimeError('Replay não voltou íntegro após restaurar o arquivo.')
print(json.dumps({'ok': True, 'synthetic': True, 'missingFileHttpStatus': missing_status,
                  'recoveredHttpStatus': recovered_status,
                  'sha256Unchanged': hash_before == hash_after == expected_hash,
                  'dbStatusUnchanged': query("SELECT status FROM \"SessionRecording\" "
                                             "WHERE \"sessionId\"='stage-media-recovery'") == 'published'},
                 sort_keys=True))
