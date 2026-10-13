#!/usr/bin/env python3
"""Prove local observer opens and clears an incident during realtime outage."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from urllib.request import urlopen

from staging_health import COMPOSE, CONFIG, ROOT, URLS, probe, values, verify_synthetic_scope


def compose(*args):
    subprocess.run(['docker', 'compose', '--env-file', str(CONFIG), '-f', str(COMPOSE),
                    *args], cwd=ROOT, check=True, stdout=subprocess.DEVNULL)


def events(path):
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def wait_for(predicate, watcher, path, label, timeout=35):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        rows = events(path)
        if predicate(rows):
            return rows
        if watcher.poll() is not None:
            raise RuntimeError(f'Observador encerrou antes de {label}.')
        time.sleep(0.2)
    raise RuntimeError(f'Observador não registrou {label} em {timeout} s.')


verify_synthetic_scope()
pg_env = {**os.environ, 'PGHOST': '127.0.0.1',
          'PGPORT': values.get('STAGE_DB_PORT', '55432'), 'PGUSER': 'edocbr_stage',
          'PGDATABASE': 'edocbr_stage', 'PGPASSWORD': values['STAGE_DB_PASSWORD']}
slugs = subprocess.run(['psql', '-X', '-qAt', '-c', 'SELECT slug FROM "Tenant" ORDER BY slug'],
                       cwd=ROOT, env=pg_env, capture_output=True, text=True,
                       check=True).stdout.strip().splitlines()
if slugs != ['staging-example']:
    raise RuntimeError('Falha induzida permitida somente na base sintética exclusiva.')
for _ in range(30):
    if not probe():
        time.sleep(1)
        if not probe():
            break
    time.sleep(1)
else:
    raise RuntimeError('A stack não estabilizou em estado saudável antes da falha induzida.')

with tempfile.TemporaryDirectory(prefix='edocbr-watch-fault-') as temporary:
    trace = Path(temporary) / 'events.jsonl'
    watcher = subprocess.Popen([sys.executable, str(ROOT / 'scripts/staging-watch.py'),
                                '--seconds', '90', '--interval', '1', '--output', str(trace),
                                '--allow-degraded', '--require-recovery', '--stop-on-recovery'],
                               cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    stopped = False
    try:
        try:
            initial = wait_for(lambda rows: bool(rows), watcher, trace, 'primeira amostra')
            if initial[0]['state'] != 'healthy':
                raise RuntimeError('O observador não iniciou em estado saudável.')
            started = time.monotonic()
            stopped = True
            compose('stop', 'realtime')
            wait_for(lambda rows: any(event['state'] == 'degraded' and
                                      any(issue.startswith('realtime:') for issue in event['issues'])
                                      for event in rows[1:]), watcher, trace, 'falha do realtime')
            detection_seconds = round(time.monotonic() - started, 2)
            with urlopen(URLS['app'], timeout=5) as response:
                if response.status != 200:
                    raise RuntimeError('Aplicação não respondeu durante a falha do realtime.')
            restart_started = time.monotonic()
        finally:
            if stopped:
                compose('start', 'realtime')
        wait_for(lambda rows: any(event['state'] == 'degraded' for event in rows[1:]) and
                 rows[-1]['state'] == 'healthy', watcher, trace, 'recuperação do realtime', timeout=60)
        recovery_seconds = round(time.monotonic() - restart_started, 2)
        stdout, stderr = watcher.communicate(timeout=10)
        if watcher.returncode:
            raise RuntimeError(f'Observador falhou: {stderr[-500:]}')
        summary = json.loads(stdout)
        recorded = events(trace)
        if not summary['recovered'] or not recorded or recorded[-1]['state'] != 'healthy':
            raise RuntimeError('Alerta não foi encerrado após recuperação.')
        print(json.dumps({'ok': True, 'synthetic': True, 'initialState': recorded[0]['state'],
                          'incidentObserved': True, 'finalState': recorded[-1]['state'],
                          'transitionCount': len(recorded), 'detectionSeconds': detection_seconds,
                          'fromRestartToHealthySeconds': recovery_seconds,
                          'appAvailableDuringRealtimeOutage': True}, sort_keys=True))
    finally:
        if watcher.poll() is None:
            watcher.terminate()
            try:
                watcher.communicate(timeout=5)
            except subprocess.TimeoutExpired:
                watcher.kill()
                watcher.communicate()
