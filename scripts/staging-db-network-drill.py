#!/usr/bin/env python3
"""Corta a rede do PostgreSQL sintético mantendo o app acessível e mede a retomada.

Exige a stack de homologação já ativa. Não cria fatos oficiais nem derruba o banco.
O bloco finally reconecta o app mesmo se uma asserção do ensaio falhar.
"""
import json
import http.cookiejar
import os
import socket
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import subprocess
import time
from urllib.error import HTTPError, URLError
from urllib.request import HTTPCookieProcessor, Request, build_opener, urlopen
from datetime import datetime, timedelta, timezone
from uuid import uuid4

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / 'deploy/staging/.env'
COMPOSE = ROOT / 'deploy/staging/compose.yaml'


def command(*args: str) -> str:
    return subprocess.run(args, cwd=ROOT, check=True, text=True,
                          capture_output=True).stdout.strip()


def compose(*args: str) -> str:
    return command('docker', 'compose', '--env-file', str(CONFIG), '-f', str(COMPOSE), *args)


def query(config: dict[str, str], sql: str) -> str:
    env = {**os.environ, 'PGHOST': '127.0.0.1', 'PGPORT': config['STAGE_DB_PORT'],
           'PGUSER': 'edocbr_stage', 'PGDATABASE': 'edocbr_stage',
           'PGPASSWORD': config['STAGE_DB_PASSWORD']}
    return subprocess.run(['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', sql],
                          cwd=ROOT, env=env, check=True, text=True,
                          capture_output=True).stdout.strip()


def http_status(base: str, path: str = '/api/v1/bootstrap') -> int:
    try:
        with urlopen(base + path, timeout=5) as response:
            response.read()
            return response.status
    except HTTPError as error:
        error.read()
        return error.code
    except (OSError, URLError):
        return 0


def app_port_open(port: int) -> bool:
    try:
        with socket.create_connection(('127.0.0.1', port), timeout=2):
            return True
    except OSError:
        return False


def request(client, base: str, path: str, payload: dict) -> tuple[int, dict]:
    data = json.dumps(payload).encode()
    try:
        with client.open(Request(base + path, data, {'Content-Type': 'application/json'}),
                         timeout=15) as response:
            return response.status, json.load(response)
    except HTTPError as error:
        return error.code, json.loads(error.read() or b'{}')
    except (OSError, URLError, TimeoutError):
        return 0, {}


def main() -> None:
    if not CONFIG.is_file() or CONFIG.is_symlink():
        raise RuntimeError('Stack sintética não inicializada.')
    config = dict(line.split('=', 1) for line in CONFIG.read_text().splitlines()
                  if '=' in line and not line.startswith('#'))
    if query(config, 'SELECT slug FROM "Tenant" ORDER BY slug') != 'staging-example':
        raise RuntimeError('Ensaio recusado: banco não contém exclusivamente staging-example.')
    base = f"http://127.0.0.1:{config.get('STAGE_APP_PORT', '3100')}"
    if http_status(base) != 200:
        raise RuntimeError('App precisa responder antes do corte.')
    if http_status(base, '/api/v1/health?ready=1') != 200:
        raise RuntimeError('Prontidão do app falhou antes do corte.')
    client = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))
    login_status, login = request(client, base, '/api/v1/auth/login', {
        'email': 'stage-admin@example.invalid', 'password': config['STAGE_ADMIN_PASSWORD']})
    if login_status != 200 or login.get('actor', {}).get('role') != 'tenant_admin':
        raise RuntimeError('Login sintético de homologação falhou.')
    tenant_id = query(config, 'SELECT id FROM "Tenant" WHERE slug=\'staging-example\'')
    operator_email = 'stage-vote-operator@example.invalid'
    existing_role = query(config, f'SELECT role FROM "User" WHERE email=\'{operator_email}\'')
    if existing_role not in ('', 'session_operator'):
        raise RuntimeError('E-mail sintético de operador pertence a outro papel.')
    if not existing_role:
        query(config, 'INSERT INTO "User" (id, "tenantId", name, email, role, "passwordHash", active, "createdAt", "updatedAt") '
              f'SELECT \'stage-vote-operator\', \'{tenant_id}\', \'Operador de Voto Sintético\', \'{operator_email}\', '
              "'session_operator', \"passwordHash\", true, now(), now() FROM \"User\" "
              "WHERE email='stage-admin@example.invalid' AND \"passwordHash\" IS NOT NULL "
              f'AND NOT EXISTS (SELECT 1 FROM "User" WHERE email=\'{operator_email}\')')
    voter = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))
    operator_status, operator = request(voter, base, '/api/v1/auth/login', {
        'email': operator_email, 'password': config['STAGE_ADMIN_PASSWORD']})
    if operator_status != 200 or operator.get('actor', {}).get('role') != 'session_operator':
        raise RuntimeError('Login do operador sintético falhou.')
    members = query(config, f'SELECT id FROM "Parliamentarian" WHERE "tenantId"=\'{tenant_id}\' AND active=true ORDER BY id LIMIT 13').splitlines()
    if len(members) < 7 or any(not item.isalnum() for item in members):
        raise RuntimeError('Quórum sintético insuficiente para a votação de ensaio.')
    president_id = members[0]

    marker = uuid4().hex
    def create_session(label: str) -> tuple[int, dict]:
        return request(client, base, '/api/v1/sessions', {
            'type': 'ordinaria', 'official': False,
            'scheduledAt': (datetime.now(timezone.utc) + timedelta(days=45)).isoformat(),
            'presidentId': president_id, 'notes': f'Ensaio rede {marker} {label}'})

    before_status, before_body = create_session('antes')
    if before_status != 201:
        raise RuntimeError(f'Escrita anterior ao corte falhou: HTTP {before_status}.')
    session_id = before_body['session']['id']
    def expected(path: str, payload: dict, status: int) -> dict:
        actual, body = request(client, base, path, payload)
        if actual != status:
            raise RuntimeError(f'{path}: HTTP {actual}, esperado {status}: {str(body)[:300]}')
        return body

    for action, version in [('schedule', 1), ('open_checkin', 2)]:
        expected(f'/api/v1/sessions/{session_id}/transition',
                 {'action': action, 'version': version}, 200)
    for member_id in members[:7]:
        expected(f'/api/v1/sessions/{session_id}/attendance',
                 {'parliamentarianId': member_id, 'action': 'check_in',
                  'commandId': str(uuid4())}, 200)
    expected(f'/api/v1/sessions/{session_id}/transition',
             {'action': 'open_session', 'version': 3}, 200)
    voting = expected(f'/api/v1/sessions/{session_id}/votings',
                      {'question': 'Ensaio de rede: aprovar?', 'mode': 'nominal'}, 201)
    voting_id = voting['voting']['id']
    expected(f'/api/v1/votings/{voting_id}/transition',
             {'action': 'open', 'version': 1}, 200)
    vote_commands = [{'parliamentarianId': member_id, 'value': 'sim',
                      'commandId': str(uuid4())} for member_id in members[:7]]

    def cast_batch() -> list[int]:
        with ThreadPoolExecutor(max_workers=len(vote_commands)) as pool:
            return list(pool.map(lambda payload: request(
                voter, base, f'/api/v1/votings/{voting_id}/votes', payload)[0],
                vote_commands))
    app_id = compose('ps', '-q', 'app')
    db_id = compose('ps', '-q', 'postgres')
    if not app_id or not db_id:
        raise RuntimeError('App e PostgreSQL precisam estar ativos.')
    app_networks = set(json.loads(command('docker', 'inspect', '-f', '{{json .NetworkSettings.Networks}}', app_id)))
    db_networks = set(json.loads(command('docker', 'inspect', '-f', '{{json .NetworkSettings.Networks}}', db_id)))
    common = app_networks & db_networks
    if len(common) != 1:
        raise RuntimeError(f'Esperava uma rede comum exclusiva; encontrei {len(common)}.')
    network = common.pop()
    disconnected = False
    try:
        command('docker', 'network', 'disconnect', network, db_id)
        disconnected = True
        # O banco segue vivo dentro do contêiner; o app mantém sua porta HTTP.
        if command('docker', 'exec', db_id, 'pg_isready', '-U', 'edocbr_stage', '-d', 'edocbr_stage').find('accepting connections') < 0:
            raise RuntimeError('PostgreSQL deixou de responder; ensaio inválido.')
        during = http_status(base)
        readiness_during = http_status(base, '/api/v1/health?ready=1')
        if not app_port_open(int(config.get('STAGE_APP_PORT', '3100'))):
            raise RuntimeError('Porta do app fechou; ensaio não isolou somente o banco.')
        if readiness_during != 503:
            raise RuntimeError(f'Prontidão não degradou para 503: HTTP {readiness_during}.')
        if 200 <= during < 300:
            raise RuntimeError('App retornou sucesso com acesso ao banco cortado.')
        write_during, during_body = create_session('durante')
        if 200 <= write_during < 300:
            raise RuntimeError('App aceitou escrita HTTP durante o corte da rede.')
        votes_during = cast_batch()
        if any(200 <= status < 300 for status in votes_during):
            raise RuntimeError('Voto retornou sucesso durante o corte da rede.')
    finally:
        if disconnected:
            command('docker', 'network', 'connect', '--alias', 'postgres', network, db_id)

    start = time.monotonic()
    for _ in range(60):
        if http_status(base) == 200:
            break
        time.sleep(1)
    else:
        raise RuntimeError('Pool do app não recuperou em 60 segundos após reconexão.')
    if query(config, 'SELECT 1') != '1':
        raise RuntimeError('PostgreSQL indisponível após reconexão.')
    for _ in range(15):
        if http_status(base, '/api/v1/health?ready=1') == 200:
            break
        time.sleep(1)
    else:
        raise RuntimeError('Prontidão não recuperou em 15 segundos.')
    after_status, after_body = create_session('depois')
    if after_status != 201:
        raise RuntimeError(f'Escrita após reconexão falhou: HTTP {after_status}.')
    votes_after = cast_batch()
    if votes_after != [200] * len(vote_commands):
        raise RuntimeError(f'Votos não foram aceitos após a reconexão: {votes_after}.')
    # Repetir a mesma chave prova que uma resposta perdida não duplica o voto.
    votes_replayed = cast_batch()
    if votes_replayed != [200] * len(vote_commands):
        raise RuntimeError(f'Repetição idempotente falhou: {votes_replayed}.')
    expected(f'/api/v1/votings/{voting_id}/transition',
             {'action': 'close', 'version': 2}, 200)
    ids = [before_body['session']['id'], after_body['session']['id']]
    if any(not item.isalnum() for item in ids):
        raise RuntimeError('ID de sessão inválido no retorno HTTP.')
    for session_id in ids:
        exists = query(config, f'SELECT count(*) FROM "Session" WHERE id=\'{session_id}\' AND "tenantId"=\'{tenant_id}\'')
        audit = query(config, f'SELECT count(*) FROM "AuditEvent" WHERE "aggregateId"=\'{session_id}\' AND action=\'session.created\'')
        if exists != '1' or audit != '1':
            raise RuntimeError(f'Escrita aceita sem sessão/auditoria persistida: {session_id}.')
    unexpected = query(config, f'SELECT count(*) FROM "Session" WHERE notes=\'Ensaio rede {marker} durante\'')
    if unexpected != '0':
        raise RuntimeError('Escrita recusada durante a falha apareceu no banco.')
    vote_count = query(config, f'SELECT count(*) FROM "Vote" WHERE "votingId"=\'{voting_id}\'')
    receipt_count = query(config, f'SELECT count(*) FROM "VoteReceipt" WHERE "votingId"=\'{voting_id}\'')
    vote_audit = query(config, f'SELECT count(*) FROM "AuditEvent" WHERE "aggregateId"=\'{voting_id}\' AND action=\'vote.cast\'')
    if (vote_count, receipt_count, vote_audit) != ('7', '7', '7'):
        raise RuntimeError('Voto, recibo ou auditoria divergiram após a reconexão.')
    print(json.dumps({'ok': True, 'scope': 'synthetic-staging',
                      'postgresStayedUp': True, 'outageHttpStatus': during,
                      'outageReadinessStatus': readiness_during,
                      'outageWriteStatus': write_during,
                      'outageVoteStatuses': votes_during, 'appPortRemainedOpen': True,
                      'recoverySeconds': round(time.monotonic() - start, 3),
                      'acceptedWritesVerified': True,
                      'acceptedSessions': ids, 'auditEventsVerified': True,
                      'voteIdempotencyVerified': True, 'voteReceiptVerified': True,
                      'concurrentVoters': len(vote_commands),
                      'remoteObserver': False}, sort_keys=True))


if __name__ == '__main__':
    main()
