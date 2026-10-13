#!/usr/bin/env python3
"""Synthetic worker outage and durable realtime outbox recovery."""
import json
from pathlib import Path
import secrets
import subprocess
import time
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / 'deploy/staging/.env'
COMPOSE = ROOT / 'deploy/staging/compose.yaml'
values = dict(line.split('=', 1) for line in CONFIG.read_text().splitlines()
              if '=' in line and not line.startswith('#'))
pg_env = {'PGHOST': '127.0.0.1', 'PGPORT': values['STAGE_DB_PORT'],
          'PGUSER': 'edocbr_stage', 'PGDATABASE': 'edocbr_stage',
          'PGPASSWORD': values['STAGE_DB_PASSWORD']}


def command(*args: str, env=None) -> str:
    import os
    result = subprocess.run(args, cwd=ROOT, env={**os.environ, **(env or {})},
                            text=True, stdout=subprocess.PIPE, check=True)
    return result.stdout.strip()


def compose(*args: str) -> None:
    command('docker', 'compose', '--env-file', str(CONFIG), '-f', str(COMPOSE), *args)


def query(sql: str) -> str:
    return command('psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', sql, env=pg_env)


def healthy(url: str) -> bool:
    try:
        with urlopen(url, timeout=2) as response:
            return response.status == 200
    except OSError:
        return False


tenant_id = query("SELECT id FROM \"Tenant\" WHERE slug='staging-example'")
if not tenant_id or not tenant_id.isalnum() or query('SELECT count(*) FROM "Tenant"') != '1':
    raise RuntimeError('Ensaio permitido somente na base sintética de homologação.')

event_id = 'stageprobe' + secrets.token_hex(12)
payload = json.dumps({'origin': 'operator', 'aggregateVersion': 1,
                      'correlationId': event_id, 'entity': 'synthetic_failover_probe'})
payload_sql = payload.replace("'", "''")
started = time.monotonic()
published = False
try:
    compose('stop', 'realtime')
    if healthy('http://127.0.0.1:3103/health'):
        raise RuntimeError('Realtime continuou respondendo após parada.')
    query('INSERT INTO "OutboxEvent" (id, "tenantId", "eventType", "aggregateId", '
          '"internalPayload", status, "createdAt") VALUES '
          f"('{event_id}', '{tenant_id}', 'structure.changed', '{event_id}', '{payload_sql}', 'pending', now())")
    if query(f"SELECT status FROM \"OutboxEvent\" WHERE id='{event_id}'") != 'pending':
        raise RuntimeError('Evento não permaneceu pendente durante a falha.')
    compose('start', 'realtime')
    for _ in range(40):
        if healthy('http://127.0.0.1:3103/health') and query(
                f"SELECT status FROM \"OutboxEvent\" WHERE id='{event_id}'") == 'published':
            published = True
            break
        time.sleep(0.25)
    if not published:
        raise RuntimeError('Realtime não publicou o evento pendente após reinício.')
    for service in ('webhooks', 'scheduler'):
        compose('stop', service)
        compose('start', service)
    if not healthy(f"http://127.0.0.1:{values.get('STAGE_APP_PORT', '3100')}/api/v1/bootstrap"):
        raise RuntimeError('Aplicação deixou de responder durante o ensaio dos workers.')
finally:
    compose('start', 'realtime', 'webhooks', 'scheduler')
    query(f"DELETE FROM \"OutboxEvent\" WHERE id='{event_id}'")

print(json.dumps({'ok': published, 'scope': 'synthetic-staging',
                  'realtimeStoppedWithPendingEvent': True,
                  'outboxPublishedAfterRestart': published,
                  'webhooksRestarted': True, 'schedulerRestarted': True,
                  'appRemainedAvailable': True,
                  'elapsedSeconds': round(time.monotonic() - started, 3),
                  'officialRtoRpoMeasured': False}, sort_keys=True))
