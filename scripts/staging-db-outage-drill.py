#!/usr/bin/env python3
"""Controlled PostgreSQL outage and HTTP recovery on synthetic staging."""
import concurrent.futures
import json
import os
from pathlib import Path
import statistics
import subprocess
import time
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / 'deploy/staging/.env'
COMPOSE = ROOT / 'deploy/staging/compose.yaml'
values = dict(line.split('=', 1) for line in CONFIG.read_text().splitlines()
              if '=' in line and not line.startswith('#'))
base = f"http://127.0.0.1:{values.get('STAGE_APP_PORT', '3100')}"
env = {**os.environ, 'PGHOST': '127.0.0.1', 'PGPORT': values['STAGE_DB_PORT'],
       'PGUSER': 'edocbr_stage', 'PGDATABASE': 'edocbr_stage',
       'PGPASSWORD': values['STAGE_DB_PASSWORD']}


def compose(*args: str) -> None:
    subprocess.run(['docker', 'compose', '--env-file', str(CONFIG), '-f',
                    str(COMPOSE), *args], cwd=ROOT, check=True)


def read(path: str, timeout=5) -> tuple[int, float]:
    started = time.monotonic()
    try:
        with urlopen(base + path, timeout=timeout) as response:
            response.read()
            return response.status, time.monotonic() - started
    except HTTPError as error:
        error.read()
        return error.code, time.monotonic() - started
    except (OSError, URLError):
        return 0, time.monotonic() - started


def load_sample() -> dict:
    paths = ['/api/v1/bootstrap', '/api/v1/public/sessions?tenant=staging-example'] * 30
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        rows = list(pool.map(read, paths))
    successful = [seconds for status, seconds in rows if status == 200]
    if len(successful) != len(rows):
        raise RuntimeError(f'Leitura sintética teve {len(rows) - len(successful)} falhas em {len(rows)} requisições.')
    ordered = sorted(successful)
    return {'requests': len(rows), 'concurrency': 8, 'errors': 0,
            'p50Ms': round(statistics.median(ordered) * 1000, 1),
            'p95Ms': round(ordered[int(0.95 * (len(ordered) - 1))] * 1000, 1)}


slugs = subprocess.run(['psql', '-X', '-qAt', '-c', 'SELECT slug FROM "Tenant" ORDER BY slug'],
                       cwd=ROOT, env=env, check=True, capture_output=True, text=True).stdout.strip().splitlines()
if slugs != ['staging-example']:
    raise RuntimeError('Ensaio permitido somente na base sintética exclusiva.')
status, _ = read('/api/v1/bootstrap')
if status != 200:
    raise RuntimeError('Bootstrap indisponível antes do ensaio.')
before = load_sample()

stopped = False
try:
    compose('stop', 'postgres')
    stopped = True
    outage_status, _ = read('/api/v1/bootstrap', timeout=8)
    if outage_status == 200:
        raise RuntimeError('API continuou respondendo com banco desligado; ensaio inválido.')
    start = time.monotonic()
    compose('start', 'postgres')
    recovered = False
    for _ in range(80):
        status, _ = read('/api/v1/bootstrap', timeout=2)
        if status == 200:
            recovered = True
            break
        time.sleep(0.25)
    if not recovered:
        raise RuntimeError('Bootstrap não voltou em até 180 segundos.')
    recovery_seconds = round(time.monotonic() - start, 3)
    after = load_sample()
    restored_media = subprocess.run(['psql', '-X', '-qAt', '-c',
                                     "SELECT status FROM \"SessionRecording\" WHERE \"sessionId\"='stage-media-recovery'"],
                                    cwd=ROOT, env=env, check=True, capture_output=True, text=True).stdout.strip()
    if restored_media != 'published':
        raise RuntimeError('Replay sintético não permaneceu publicado após falha do banco.')
finally:
    if stopped:
        compose('start', 'postgres')

print(json.dumps({'ok': True, 'scope': 'synthetic-staging', 'profile': '60 HTTP reads / 8 clients',
                  'before': before, 'after': after, 'outageHttpStatus': outage_status,
                  'fromDatabaseStartToUsefulHttpSeconds': recovery_seconds,
                  'syntheticReplayRetained': True, 'officialRtoRpoMeasured': False}, sort_keys=True))
