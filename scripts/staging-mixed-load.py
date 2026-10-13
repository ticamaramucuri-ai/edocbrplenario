#!/usr/bin/env python3
"""Exercise synthetic voting, public reads and replay on one staging host."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
import statistics
import subprocess
import sys
import threading
import time
from urllib.request import Request, urlopen

from staging_health import ROOT, URLS, probe, values, verify_synthetic_scope

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--seconds', type=int, default=40)
parser.add_argument('--runs', type=int, default=3)
parser.add_argument('--readers', type=int, default=4)
args = parser.parse_args()
if not 15 <= args.seconds <= 300 or not 1 <= args.runs <= 10 or not 1 <= args.readers <= 16:
    parser.error('Use 15–300 segundos, 1–10 jornadas e 1–16 leitores.')

verify_synthetic_scope()
pg_env = {**os.environ, 'PGHOST': '127.0.0.1',
          'PGPORT': values.get('STAGE_DB_PORT', '55432'), 'PGUSER': 'edocbr_stage',
          'PGDATABASE': 'edocbr_stage', 'PGPASSWORD': values['STAGE_DB_PASSWORD']}


def query(sql):
    return subprocess.run(['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', sql],
                          cwd=ROOT, env=pg_env, capture_output=True, text=True,
                          check=True).stdout.strip()


if query('SELECT slug FROM "Tenant" ORDER BY slug') != 'staging-example':
    raise RuntimeError('Carga mista permitida somente na base sintética exclusiva.')
if probe():
    raise RuntimeError('A stack precisa estar saudável antes da carga mista.')
expected_hash = query("SELECT \"replaySha256\" FROM \"SessionRecording\" "
                      "WHERE \"sessionId\"='stage-media-recovery' AND status='published'")
if len(expected_hash) != 64:
    raise RuntimeError('Replay sintético ausente; execute staging-media-drill.py.')
base = URLS['app'].removesuffix('/api/v1/bootstrap')
routes = ('bootstrap', 'sessions', 'replay')
paths = ('/api/v1/bootstrap', '/api/v1/public/sessions?tenant=staging-example',
         '/api/v1/public/sessions/stage-media-recovery/replay?tenant=staging-example')


def read(kind):
    started = time.monotonic()
    try:
        with urlopen(Request(base + paths[kind]), timeout=10) as response:
            body = response.read()
            status = response.status
        if kind == 0:
            valid = status == 200 and (json.loads(body).get('tenant') or {}).get('slug') == 'staging-example'
        elif kind == 1:
            valid = status == 200 and isinstance(json.loads(body).get('sessions'), list)
        else:
            valid = status == 200 and hashlib.sha256(body).hexdigest() == expected_hash
        return kind, valid, round((time.monotonic() - started) * 1000, 2), len(body)
    except Exception:
        return kind, False, round((time.monotonic() - started) * 1000, 2), 0


for kind in range(len(routes)):
    if not read(kind)[1]:
        raise RuntimeError(f'Pré-condição da rota pública {routes[kind]} falhou.')

stop = threading.Event()


def reader(index):
    rows = []
    turn = index
    while not stop.is_set():
        rows.append(read(turn % len(routes)))
        turn += 1
        stop.wait(0.05)
    return rows


started = time.monotonic()
loads = []
health_issues = []
writer = None
with ThreadPoolExecutor(max_workers=args.readers) as pool:
    futures = [pool.submit(reader, index) for index in range(args.readers)]
    try:
        for run in range(args.runs):
            writer = subprocess.Popen([sys.executable, str(ROOT / 'scripts/staging-vote-load.py')],
                                      cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            deadline = time.monotonic() + 120
            while writer.poll() is None:
                if time.monotonic() >= deadline:
                    raise RuntimeError('Jornada de votação excedeu 120 segundos.')
                issues = probe()
                if issues:
                    health_issues.append({'run': run + 1, 'issues': issues})
                time.sleep(2)
            stdout, stderr = writer.communicate(timeout=5)
            if writer.returncode:
                raise RuntimeError(f'Jornada de votação falhou: {stderr[-1000:]}')
            loads.append(json.loads(stdout))
            writer = None
        while time.monotonic() - started < args.seconds:
            issues = probe()
            if issues:
                health_issues.append({'run': 'cooldown', 'issues': issues})
            time.sleep(2)
    finally:
        stop.set()
        if writer is not None and writer.poll() is None:
            writer.terminate()
            try:
                writer.communicate(timeout=5)
            except subprocess.TimeoutExpired:
                writer.kill()
                writer.communicate()
    rows = [row for future in futures for row in future.result(timeout=15)]

for load in loads:
    session_id = load['sessionId']
    if not session_id.isalnum():
        raise RuntimeError('ID de sessão sintética inválido.')
    deadline = time.monotonic() + 45
    while query(f"SELECT count(*) FROM \"OutboxEvent\" WHERE \"sessionId\"='{session_id}' "
                "AND status<>'published'") != '0':
        if time.monotonic() >= deadline:
            raise RuntimeError('A outbox da sessão não drenou após a carga mista.')
        time.sleep(0.5)

by_route = []
for kind, name in enumerate(routes):
    selected = [row for row in rows if row[0] == kind]
    ordered = sorted(row[2] for row in selected)
    by_route.append({'route': name, 'requests': len(selected),
                     'errors': sum(not row[1] for row in selected),
                     'bytes': sum(row[3] for row in selected),
                     'p95Ms': ordered[int(0.95 * (len(ordered) - 1))] if ordered else None})
ok = (bool(rows) and len(loads) == args.runs and not health_issues and
      all(row[1] for row in rows) and all(load['ok'] for load in loads))
print(json.dumps({'ok': ok, 'synthetic': True, 'official': False,
                  'durationSeconds': round(time.monotonic() - started, 2),
                  'readers': args.readers, 'readRequests': len(rows),
                  'readErrors': sum(not row[1] for row in rows),
                  'healthFailures': health_issues, 'routes': by_route,
                  'runs': len(loads), 'votes': sum(load['votes'] for load in loads),
                  'receipts': sum(load['receipts'] for load in loads),
                  'voteOutboxEvents': sum(load['voteOutboxEvents'] for load in loads),
                  'replaySha256': expected_hash,
                  'worstVoteP95Ms': max(load['voteP95Ms'] for load in loads)}, sort_keys=True))
if not ok:
    raise SystemExit(1)
