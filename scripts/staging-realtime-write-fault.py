#!/usr/bin/env python3
"""Continue synthetic voting writes while realtime is offline, then drain outbox."""
import json
import atexit
import os
import subprocess
import sys
import time
from urllib.request import urlopen

from staging_health import COMPOSE, CONFIG, ROOT, URLS, values, verify_synthetic_scope

pg_env = {**os.environ, 'PGHOST': '127.0.0.1',
          'PGPORT': values.get('STAGE_DB_PORT', '55432'), 'PGUSER': 'edocbr_stage',
          'PGDATABASE': 'edocbr_stage', 'PGPASSWORD': values['STAGE_DB_PASSWORD']}


def query(sql):
    return subprocess.run(['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', sql],
                          cwd=ROOT, env=pg_env, text=True, capture_output=True,
                          check=True).stdout.strip()


def compose(*args):
    subprocess.run(['docker', 'compose', '--env-file', str(CONFIG), '-f', str(COMPOSE),
                    *args], cwd=ROOT, stdout=subprocess.DEVNULL, check=True)


def wait_for(predicate, label, timeout=45):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        result = predicate()
        if result:
            return result
        time.sleep(0.2)
    raise RuntimeError(f'Tempo excedido aguardando {label}.')


verify_synthetic_scope()
if query('SELECT slug FROM "Tenant" ORDER BY slug') != 'staging-example':
    raise RuntimeError('Falha induzida permitida somente na base sintética exclusiva.')
note = 'Ensaio sintético de carga de votação'
latest_sql = f"SELECT id FROM \"Session\" WHERE notes='{note}' ORDER BY \"createdAt\" DESC LIMIT 1"
previous_id = query(latest_sql)
writer = subprocess.Popen([sys.executable, str(ROOT / 'scripts/staging-vote-load.py')],
                          cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
def stop_writer_on_exit():
    if writer.poll() is None:
        writer.terminate()
        try:
            writer.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            writer.kill()
            writer.communicate()


atexit.register(stop_writer_on_exit)
stopped = False
try:
    session_id = wait_for(lambda: (current if (current := query(latest_sql)) != previous_id else ''),
                          'criação da sessão sintética', timeout=20)
    if writer.poll() is not None:
        raise RuntimeError('A carga terminou antes da falha induzida.')
    stopped = True
    compose('stop', 'realtime')
    pending_sql = (f"SELECT count(*) FROM \"OutboxEvent\" WHERE \"sessionId\"='{session_id}' "
                   "AND status='pending'")
    pending_during_outage = int(wait_for(lambda: int(query(pending_sql)), 'evento pendente com realtime parado'))
    with urlopen(URLS['app'], timeout=5) as response:
        if response.status != 200:
            raise RuntimeError('Aplicação não respondeu durante a falha do realtime.')
    started_recovery = time.monotonic()
finally:
    if stopped:
        compose('start', 'realtime')
try:
    stdout, stderr = writer.communicate(timeout=120)
except subprocess.TimeoutExpired:
    writer.kill()
    writer.communicate()
    raise RuntimeError('Carga de escrita não terminou em 120 segundos.')
if writer.returncode:
    raise RuntimeError(f'Escrita falhou durante indisponibilidade do realtime: {stderr[-1000:]}')
write_result = json.loads(stdout)
wait_for(lambda: query(pending_sql) == '0', 'drenagem da outbox', timeout=60)
recovery_seconds = round(time.monotonic() - started_recovery, 2)
total_events = int(query(f"SELECT count(*) FROM \"OutboxEvent\" WHERE \"sessionId\"='{session_id}'"))
published_events = int(query(f"SELECT count(*) FROM \"OutboxEvent\" WHERE \"sessionId\"='{session_id}' "
                             "AND status='published'"))
if total_events < write_result['votes'] or total_events != published_events:
    raise RuntimeError('Eventos da sessão não foram publicados integralmente após o retorno.')
print(json.dumps({'ok': True, 'synthetic': True, 'votes': write_result['votes'],
                  'receipts': write_result['receipts'], 'voteOutboxEvents': write_result['voteOutboxEvents'],
                  'pendingDuringOutage': pending_during_outage,
                  'publishedSessionEvents': published_events,
                  'fromRestartToDrainSeconds': recovery_seconds,
                  'appAvailableDuringOutage': True, 'officialRtoRpoMeasured': False}, sort_keys=True))
