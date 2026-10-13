#!/usr/bin/env python3
"""Authenticated synthetic session with concurrent votes on isolated PostgreSQL staging."""
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
import http.cookiejar
import json
import os
from pathlib import Path
import statistics
import subprocess
import time
from urllib.error import HTTPError
from urllib.request import HTTPCookieProcessor, Request, build_opener
from uuid import uuid4

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / 'deploy/staging/.env'
values = dict(line.split('=', 1) for line in CONFIG.read_text().splitlines()
              if '=' in line and not line.startswith('#'))
base = f"http://127.0.0.1:{values.get('STAGE_APP_PORT', '3100')}"
env = {**os.environ, 'PGHOST': '127.0.0.1', 'PGPORT': values.get('STAGE_DB_PORT', '55432'),
       'PGUSER': 'edocbr_stage', 'PGDATABASE': 'edocbr_stage',
       'PGPASSWORD': values['STAGE_DB_PASSWORD']}
operator_email = 'stage-vote-operator@example.invalid'
rounds = 20
members = 11


def query(sql):
    result = subprocess.run(['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', sql],
                            cwd=ROOT, env=env, text=True, capture_output=True, check=True)
    return result.stdout.strip()


def client():
    jar = http.cookiejar.CookieJar()
    return build_opener(HTTPCookieProcessor(jar)), jar


def call(opener, path, payload=None, expected=200):
    body = None if payload is None else json.dumps(payload).encode()
    req = Request(base + path, body, {'Content-Type': 'application/json'} if body else {})
    started = time.monotonic()
    try:
        with opener.open(req, timeout=20) as response:
            status, data = response.status, response.read()
    except HTTPError as error:
        status, data = error.code, error.read()
    elapsed = round((time.monotonic() - started) * 1000, 2)
    if status != expected:
        raise RuntimeError(f'{path}: HTTP {status}, esperado {expected}: {data[:350].decode(errors="replace")}')
    return json.loads(data), elapsed


if query('SELECT count(*) FROM "Tenant"') != '1':
    raise RuntimeError('Ensaio permitido somente na base sintética exclusiva.')
tenant_id = query("SELECT id FROM \"Tenant\" WHERE slug='staging-example'")
if not tenant_id or not tenant_id.isalnum():
    raise RuntimeError('Tenant sintético ausente.')
if query(f"SELECT role FROM \"User\" WHERE email='{operator_email}'") not in ('', 'session_operator'):
    raise RuntimeError('O e-mail de ensaio pertence a outro papel; intervenção manual necessária.')
query('INSERT INTO "User" (id, "tenantId", name, email, role, "passwordHash", active, "createdAt", "updatedAt") '
      f"SELECT 'stage-vote-operator', '{tenant_id}', 'Operador de Voto Sintético', '{operator_email}', "
      "'session_operator', \"passwordHash\", true, now(), now() FROM \"User\" "
      "WHERE email='stage-admin@example.invalid' AND \"passwordHash\" IS NOT NULL "
      f"AND NOT EXISTS (SELECT 1 FROM \"User\" WHERE email='{operator_email}')")
if query(f"SELECT role FROM \"User\" WHERE email='{operator_email}'") != 'session_operator':
    raise RuntimeError('Operador sintético não foi provisionado.')

admin, _ = client()
operator, _ = client()
assert call(admin, '/api/v1/auth/login', {'email': 'stage-admin@example.invalid',
                                          'password': values['STAGE_ADMIN_PASSWORD']})[0]['actor']['role'] == 'tenant_admin'
assert call(operator, '/api/v1/auth/login', {'email': operator_email,
                                             'password': values['STAGE_ADMIN_PASSWORD']})[0]['actor']['role'] == 'session_operator'

people = call(admin, '/api/v1/parliamentarians')[0]['parliamentarians']
synthetic = [p for p in people if p['name'].startswith('Parlamentar de Carga ')]
for index in range(len(synthetic), members - 1):
    item = call(admin, '/api/v1/parliamentarians',
                {'name': f'Parlamentar de Carga {index + 1:02}', 'party': 'EXP'}, 201)[0]
    synthetic.append(item['parliamentarian'])
president = next((p for p in people if p['name'] == 'Presidente de Ensaio'), None)
if not president or len(synthetic) < members - 1:
    raise RuntimeError('Execute scripts/staging-smoke.py antes da prova de votação.')
voters = [president, *synthetic[:members - 1]]
session, _ = call(admin, '/api/v1/sessions', {
    'type': 'ordinaria',
    'scheduledAt': (datetime.now(timezone.utc) + timedelta(days=40)).isoformat(),
    'presidentId': president['id'], 'notes': 'Ensaio sintético de carga de votação',
    'official': False,
}, 201)
session_id = session['session']['id']
session_version = 1
for action in ('schedule', 'open_checkin'):
    call(admin, f'/api/v1/sessions/{session_id}/transition', {'action': action, 'version': session_version})
    session_version += 1
for person in voters:
    call(admin, f'/api/v1/sessions/{session_id}/attendance',
         {'parliamentarianId': person['id'], 'action': 'check_in', 'commandId': str(uuid4())})
call(admin, f'/api/v1/sessions/{session_id}/transition', {'action': 'open_session', 'version': session_version})
session_version += 1

vote_times = []
voting_ids = []
for round_number in range(rounds):
    created, _ = call(admin, f'/api/v1/sessions/{session_id}/votings',
                      {'question': f'Ensaio sintético {round_number + 1}: aprovar?', 'mode': 'nominal'}, 201)
    voting_id = created['voting']['id']
    voting_ids.append(voting_id)
    call(admin, f'/api/v1/votings/{voting_id}/transition', {'action': 'open', 'version': 1})
    commands = [(person['id'], str(uuid4())) for person in voters]
    with ThreadPoolExecutor(max_workers=members) as pool:
        futures = [pool.submit(call, operator, f'/api/v1/votings/{voting_id}/votes',
                               {'parliamentarianId': person_id, 'value': 'sim', 'commandId': command_id})
                   for person_id, command_id in commands]
        for future in as_completed(futures):
            _, elapsed = future.result()
            vote_times.append(elapsed)
    # A mesma chave de comando deve devolver o voto existente sem duplicá-lo.
    call(operator, f'/api/v1/votings/{voting_id}/votes',
         {'parliamentarianId': commands[0][0], 'value': 'sim', 'commandId': commands[0][1]})
    closed, _ = call(admin, f'/api/v1/votings/{voting_id}/transition', {'action': 'close', 'version': 2})
    if closed['voting']['status'] != 'closed':
        raise RuntimeError('Votação não foi encerrada.')
call(admin, f'/api/v1/sessions/{session_id}/transition', {'action': 'close', 'version': session_version})

voting_list = ','.join(f"'{vote_id}'" for vote_id in voting_ids)
vote_count = int(query(f'SELECT count(*) FROM "Vote" WHERE "votingId" IN ({voting_list})'))
receipt_count = int(query(f'SELECT count(*) FROM "VoteReceipt" WHERE "votingId" IN ({voting_list})'))
audit_count = int(query(f"SELECT count(*) FROM \"AuditEvent\" WHERE \"aggregateId\"='{session_id}'"))
vote_audit_count = int(query(f"SELECT count(*) FROM \"AuditEvent\" WHERE action='vote.cast' "
                             f'AND "aggregateId" IN ({voting_list})'))
vote_event_count = int(query(f"SELECT count(*) FROM \"OutboxEvent\" WHERE \"eventType\"='vote.recorded' "
                             f'AND "aggregateId" IN ({voting_list})'))
if (vote_count != rounds * members or receipt_count != vote_count or vote_audit_count != vote_count
        or vote_event_count != vote_count or audit_count < 4):
    raise RuntimeError('Votos, recibos ou auditoria divergentes após a carga.')
ordered = sorted(vote_times)
print(json.dumps({'ok': True, 'synthetic': True, 'official': False, 'rounds': rounds,
                  'concurrentVoters': members, 'votes': vote_count, 'receipts': receipt_count,
                  'sessionAuditEvents': audit_count, 'voteAuditEvents': vote_audit_count,
                  'voteOutboxEvents': vote_event_count, 'idempotentReplayPerRound': True,
                  'voteP50Ms': statistics.median(ordered),
                  'voteP95Ms': ordered[int(0.95 * (len(ordered) - 1))]}, sort_keys=True))
