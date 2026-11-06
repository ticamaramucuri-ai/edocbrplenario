#!/usr/bin/env python3
"""Two independent app containers on one synthetic PostgreSQL deliberation."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import http.cookiejar
import json
import os
import re
import subprocess
import time
from urllib.error import HTTPError, URLError
from urllib.request import HTTPCookieProcessor, Request, build_opener, urlopen
from uuid import uuid4

from staging_health import ROOT, probe, values, verify_synthetic_scope

CONFIG = ROOT / 'deploy/staging/.env'
COMPOSE = ROOT / 'deploy/staging/compose.yaml'
PG = {**os.environ, 'PGHOST': '127.0.0.1', 'PGPORT': values.get('STAGE_DB_PORT', '55432'),
      'PGUSER': 'edocbr_stage', 'PGDATABASE': 'edocbr_stage', 'PGPASSWORD': values['STAGE_DB_PASSWORD']}
BASE = f"http://127.0.0.1:{values.get('STAGE_APP_PORT', '3100')}"


def query(sql: str) -> str:
    result = subprocess.run(['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', sql],
                            cwd=ROOT, env=PG, capture_output=True, text=True, check=True)
    return result.stdout.strip()


def client():
    return build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))


def call(opener, base: str, path: str, payload=None) -> tuple[int, dict]:
    data = None if payload is None else json.dumps(payload).encode()
    request = Request(base + path, data, {'Content-Type': 'application/json'} if data else {})
    try:
        with opener.open(request, timeout=20) as response:
            status, raw = response.status, response.read()
    except HTTPError as error:
        status, raw = error.code, error.read()
    return status, json.loads(raw) if raw else {}


def require(response: tuple[int, dict], expected: int, label: str) -> dict:
    status, body = response
    if status != expected:
        raise RuntimeError(f'{label}: HTTP {status}, esperado {expected}; {str(body)[:250]}')
    return body


verify_synthetic_scope()
if query('SELECT slug FROM "Tenant" ORDER BY slug') != 'staging-example':
    raise RuntimeError('Prova permitida somente na base sintética exclusiva.')
if query("SELECT count(*) FROM \"Session\" WHERE status IN ('check_in','open','suspended','resumed')") != '0':
    raise RuntimeError('Há sessão em andamento; prova recusada.')
if probe():
    raise RuntimeError('Stack sintética não está saudável.')
members = query('SELECT id FROM "Parliamentarian" WHERE "tenantId"=(SELECT id FROM "Tenant" WHERE slug=\'staging-example\') AND active=true ORDER BY id LIMIT 7').splitlines()
if len(members) != 7 or any(not member.isalnum() for member in members):
    raise RuntimeError('São necessários sete parlamentares fictícios ativos.')
if query("SELECT role FROM \"User\" WHERE email='stage-vote-operator@example.invalid'") != 'session_operator':
    raise RuntimeError('Operador sintético ausente; execute scripts/staging-vote-load.py uma vez.')

name = f'edocbr-stage-app-peer-{uuid4().hex[:12]}'
peer = None
session_ids = []
try:
    started = subprocess.run(['docker', 'compose', '--env-file', str(CONFIG), '-f', str(COMPOSE),
                              'run', '-d', '--no-deps', '--name', name,
                              '-p', '127.0.0.1::3000', 'app'], cwd=ROOT,
                             capture_output=True, text=True, check=True)
    peer = started.stdout.strip()
    if not re.fullmatch(r'[a-f0-9]{64}', peer):
        raise RuntimeError(f'Identificador inesperado do segundo contêiner: {peer[:100]}')
    port_line = subprocess.run(['docker', 'port', name, '3000/tcp'], cwd=ROOT,
                               capture_output=True, text=True, check=True).stdout.strip()
    port = int(port_line.rsplit(':', 1)[-1])
    peer_base = f'http://127.0.0.1:{port}'
    for _ in range(60):
        try:
            with urlopen(peer_base + '/api/v1/health?ready=1', timeout=2) as response:
                if response.status == 200:
                    break
        except (OSError, URLError, TimeoutError):
            pass
        time.sleep(0.5)
    else:
        raise RuntimeError('Segunda instância não ficou pronta.')
    primary_id = subprocess.run(['docker', 'compose', '--env-file', str(CONFIG), '-f', str(COMPOSE),
                                 'ps', '-q', 'app'], cwd=ROOT, capture_output=True,
                                text=True, check=True).stdout.strip()
    if not primary_id or primary_id == peer:
        raise RuntimeError('As duas URLs não correspondem a processos separados.')

    admin_a, admin_b, operator_a, operator_b = client(), client(), client(), client()
    for opener, base, email, role in [
        (admin_a, BASE, 'stage-admin@example.invalid', 'tenant_admin'),
        (admin_b, peer_base, 'stage-admin@example.invalid', 'tenant_admin'),
        (operator_a, BASE, 'stage-vote-operator@example.invalid', 'session_operator'),
        (operator_b, peer_base, 'stage-vote-operator@example.invalid', 'session_operator'),
    ]:
        body = require(call(opener, base, '/api/v1/auth/login', {
            'email': email, 'password': values['STAGE_ADMIN_PASSWORD']}), 200, 'login')
        if body['actor']['role'] != role:
            raise RuntimeError('Papel sintético divergente.')

    created = require(call(admin_a, BASE, '/api/v1/sessions', {
        'type': 'ordinaria', 'official': False,
        'scheduledAt': (datetime.now(timezone.utc) + timedelta(days=50)).isoformat(),
        'presidentId': members[0], 'notes': 'Ensaio fictício de duas instâncias HTTP',
    }), 201, 'criar sessão')
    session_id = created['session']['id']
    session_ids.append(session_id)
    require(call(admin_b, peer_base, f'/api/v1/sessions/{session_id}/transition',
                 {'action': 'schedule', 'version': 1}), 200, 'agendar por B')
    require(call(admin_a, BASE, f'/api/v1/sessions/{session_id}/transition',
                 {'action': 'open_checkin', 'version': 2}), 200, 'credenciar por A')
    for index, person in enumerate(members):
        opener, base = (admin_a, BASE) if index % 2 == 0 else (admin_b, peer_base)
        require(call(opener, base, f'/api/v1/sessions/{session_id}/attendance', {
            'parliamentarianId': person, 'action': 'check_in', 'commandId': str(uuid4()),
        }), 200, f'presença {index}')
    require(call(admin_b, peer_base, f'/api/v1/sessions/{session_id}/transition',
                 {'action': 'open_session', 'version': 3}), 200, 'abrir sessão por B')
    voting = require(call(admin_a, BASE, f'/api/v1/sessions/{session_id}/votings', {
        'question': 'Aprovar deliberação sintética em duas instâncias?',
        'mode': 'nominal', 'rule': 'maioria_simples',
    }), 201, 'criar votação')
    voting_id = voting['voting']['id']
    require(call(admin_b, peer_base, f'/api/v1/votings/{voting_id}/transition',
                 {'action': 'open', 'version': 1}), 200, 'abrir votação por B')

    ballots = ['sim', 'sim', 'sim', 'sim', 'nao', 'nao', 'nao']
    commands = [{'parliamentarianId': person, 'value': value, 'commandId': str(uuid4())}
                for person, value in zip(members, ballots)]
    with ThreadPoolExecutor(max_workers=6) as pool:
        futures = [pool.submit(call, operator_a if i % 2 == 0 else operator_b,
                               BASE if i % 2 == 0 else peer_base,
                               f'/api/v1/votings/{voting_id}/votes', command)
                   for i, command in enumerate(commands[:6])]
        for i, future in enumerate(futures):
            require(future.result(), 200, f'voto paralelo {i}')
    # A mesma chave simultânea em duas instâncias deve representar UM voto.
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(call, operator_a, BASE, f'/api/v1/votings/{voting_id}/votes', commands[6])
        second = pool.submit(call, operator_b, peer_base, f'/api/v1/votings/{voting_id}/votes', commands[6])
        duplicate_statuses = [first.result()[0], second.result()[0]]
    if duplicate_statuses != [200, 200]:
        raise RuntimeError(f'Comando repetido entre instâncias: {duplicate_statuses}')

    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(call, admin_a, BASE, f'/api/v1/votings/{voting_id}/transition',
                            {'action': 'close', 'version': 2})
        second = pool.submit(call, admin_b, peer_base, f'/api/v1/votings/{voting_id}/transition',
                             {'action': 'close', 'version': 2})
        close_statuses = sorted([first.result()[0], second.result()[0]])
    if close_statuses != [200, 409]:
        raise RuntimeError(f'Fechamento concorrente inesperado: {close_statuses}')
    row = query(f'SELECT "resultStatus", "resultCounts", "presentAtClose", "memberBaseAtOpen" '
                f'FROM "Voting" WHERE id=\'{voting_id}\'')
    status, counts_json, present, base = row.split('|')
    counts = json.loads(counts_json)
    expected = {'sim': 4, 'nao': 3, 'abstencoes': 0, 'naoRegistraram': 0, 'presentes': 7}
    if (status, counts, int(present)) != ('aprovado', expected, 7) or int(base) < 7:
        raise RuntimeError('Resultado PostgreSQL divergiu do livro de papel.')
    votes = int(query(f'SELECT count(*) FROM "Vote" WHERE "votingId"=\'{voting_id}\''))
    receipts = int(query(f'SELECT count(*) FROM "VoteReceipt" WHERE "votingId"=\'{voting_id}\''))
    audits = int(query(f"SELECT count(*) FROM \"AuditEvent\" WHERE \"aggregateId\"='{voting_id}' AND action='vote.cast'"))
    if (votes, receipts, audits) != (7, 7, 7):
        raise RuntimeError('Voto, recibo ou auditoria duplicados entre instâncias.')
    report = require(call(admin_b, peer_base, f'/api/v1/reports/session/{session_id}/ata'), 200, 'ata por B')
    if report['ata']['votings'][0]['result'] != 'aprovado' or report['ata']['votings'][0]['counts'] != expected:
        raise RuntimeError('Ata da segunda instância divergiu da apuração independente.')
    public = require(call(admin_a, BASE, f'/api/v1/public/sessions/{session_id}?tenant=staging-example'), 200, 'portal por A')
    if public['votings'][0]['resultStatus'] != 'aprovado' or public['votings'][0]['resultCounts'] != expected:
        raise RuntimeError('Portal da primeira instância divergiu da apuração independente.')
    require(call(admin_a, BASE, f'/api/v1/sessions/{session_id}/transition',
                 {'action': 'close', 'version': 4}), 200, 'encerrar sessão')
    # A configuração regimental institucional não existe neste laboratório. O
    # segundo caso cria apenas o estado inicial fictício; os atos de conferência
    # e encerramento continuam passando pelas APIs reais das duas instâncias.
    tenant_id = query("SELECT id FROM \"Tenant\" WHERE slug='staging-example'")
    chair_email = 'stage-symbolic-chair@example.invalid'
    chair_id = query(f"SELECT id FROM \"User\" WHERE email='{chair_email}'")
    if not chair_id:
        chair_id = uuid4().hex
        query('INSERT INTO "User" (id, "tenantId", name, email, role, "passwordHash", active, "createdAt", "updatedAt") '
              f"SELECT '{chair_id}', '{tenant_id}', 'Presidência fictícia', '{chair_email}', "
              "'presiding_officer', \"passwordHash\", true, now(), now() FROM \"User\" "
              "WHERE email='stage-admin@example.invalid' AND \"passwordHash\" IS NOT NULL")
    if query(f"SELECT role FROM \"User\" WHERE id='{chair_id}'") != 'presiding_officer':
        raise RuntimeError('Conta de conferência sintética inválida.')
    chair_b = client()
    require(call(chair_b, peer_base, '/api/v1/auth/login', {
        'email': chair_email, 'password': values['STAGE_ADMIN_PASSWORD']}), 200, 'login da Presidência fictícia')

    symbolic_session = uuid4().hex
    symbolic_voting = uuid4().hex
    number = int(query(f'SELECT COALESCE(MAX(number), 0) + 1 FROM "Session" '
                       f'WHERE "tenantId"=\'{tenant_id}\' AND year=2039'))
    query('INSERT INTO "Session" (id, "tenantId", number, year, type, "scheduledAt", "openedAt", status, '
          'official, version, "createdAt", "updatedAt") '
          f"VALUES ('{symbolic_session}', '{tenant_id}', {number}, 2039, 'ordinaria', now(), now(), "
          "'open', true, 4, now(), now())")
    session_ids.append(symbolic_session)
    for index, person in enumerate(members):
        opener, base = (admin_a, BASE) if index % 2 == 0 else (admin_b, peer_base)
        require(call(opener, base, f'/api/v1/sessions/{symbolic_session}/attendance', {
            'parliamentarianId': person, 'action': 'check_in', 'commandId': str(uuid4()),
        }), 200, f'presença simbólica {index}')
    eligible = json.dumps(members).replace("'", "''")
    query('INSERT INTO "Voting" (id, "sessionId", question, mode, status, rule, "requiredQuorum", '
          '"openedAt", "presentAtOpen", "quorumAtOpen", "memberBaseAtOpen", '
          '"eligibleVoterIdsAtOpen", version, "createdAt", "updatedAt") '
          f"VALUES ('{symbolic_voting}', '{symbolic_session}', 'Deliberação simbólica fictícia?', "
          f"'simbolico', 'open', 'maioria_simples', 2, now(), 7, 7, 7, '{eligible}', 2, now(), now())")
    symbolic_path = f'/api/v1/votings/{symbolic_voting}'
    require(call(operator_a, BASE, symbolic_path + '/transition', {
        'action': 'close', 'version': 2}), 409, 'fechamento sem conferência')
    proposal_payload = {'action': 'propose', 'version': 2, 'sim': 3, 'nao': 3, 'abstencoes': 1}
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(call, operator_a, BASE, symbolic_path + '/symbolic-tally', proposal_payload)
        second = pool.submit(call, admin_b, peer_base, symbolic_path + '/symbolic-tally', proposal_payload)
        proposals = [first.result(), second.result()]
    proposal_statuses = sorted(response[0] for response in proposals)
    if proposal_statuses != [200, 409]:
        raise RuntimeError(f'Propostas simbólicas concorrentes inesperadas: {proposal_statuses}')
    proposed = next(body for status_code, body in proposals if status_code == 200)
    revision_id = proposed['revision']['id']
    if proposed['version'] != 3:
        raise RuntimeError('Revisão simbólica não avançou para a versão 3.')
    require(call(operator_a, BASE, symbolic_path + '/symbolic-tally', {
        'action': 'confirm', 'version': 3, 'revisionId': revision_id,
    }), 403, 'mesma identidade não confirma')
    require(call(operator_b, peer_base, symbolic_path + '/transition', {
        'action': 'close', 'version': 3}), 409, 'fechamento antes da confirmação')
    confirmed = require(call(chair_b, peer_base, symbolic_path + '/symbolic-tally', {
        'action': 'confirm', 'version': 3, 'revisionId': revision_id,
    }), 200, 'confirmação independente por B')
    if confirmed['version'] != 4 or confirmed['revision']['confirmedById'] != chair_id:
        raise RuntimeError('Revisão simbólica não recebeu a segunda identidade.')
    require(call(operator_a, BASE, symbolic_path + '/transition', {
        'action': 'close', 'version': 4, 'sim': 4, 'nao': 3, 'abstencoes': 0,
    }), 422, 'contagem avulsa recusada')
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(call, operator_a, BASE, symbolic_path + '/transition',
                            {'action': 'close', 'version': 4})
        second = pool.submit(call, admin_b, peer_base, symbolic_path + '/transition',
                             {'action': 'close', 'version': 4})
        symbolic_close = sorted([first.result()[0], second.result()[0]])
    if symbolic_close != [200, 409]:
        raise RuntimeError(f'Fechamento simbólico concorrente inesperado: {symbolic_close}')
    symbolic_row = query(f'SELECT "resultStatus", "resultCounts" FROM "Voting" WHERE id=\'{symbolic_voting}\'')
    symbolic_status, symbolic_counts_json = symbolic_row.split('|')
    symbolic_counts = json.loads(symbolic_counts_json)
    symbolic_expected = {'sim': 3, 'nao': 3, 'abstencoes': 1, 'naoRegistraram': 0, 'presentes': 7}
    if symbolic_status != 'empate' or symbolic_counts != symbolic_expected:
        raise RuntimeError('Contagem simbólica PostgreSQL divergiu da revisão confirmada.')
    revision_row = query(f'SELECT count(*), min("proposedById"), min("confirmedById") '
                         f'FROM "SymbolicTallyRevision" WHERE "votingId"=\'{symbolic_voting}\'')
    revision_count, proposer, confirmer = revision_row.split('|')
    if int(revision_count) != 1 or proposer == confirmer or confirmer != chair_id:
        raise RuntimeError('Conferência simbólica perdeu a segregação de identidades.')
    tally_audits = query(f"SELECT action, count(*) FROM \"AuditEvent\" WHERE \"aggregateId\"='{symbolic_voting}' "
                         "AND action IN ('voting.symbolic_tally.proposed', 'voting.symbolic_tally.confirmed') "
                         'GROUP BY action ORDER BY action').splitlines()
    if tally_audits != ['voting.symbolic_tally.confirmed|1', 'voting.symbolic_tally.proposed|1']:
        raise RuntimeError(f'Auditoria de conferência duplicada ou incompleta: {tally_audits}')
    symbolic_ata = require(call(admin_a, BASE, f'/api/v1/reports/session/{symbolic_session}/ata'), 200, 'ata simbólica por A')
    if symbolic_ata['ata']['votings'][0]['result'] != 'empate' or symbolic_ata['ata']['votings'][0]['counts'] != symbolic_expected:
        raise RuntimeError('Ata simbólica divergiu da revisão confirmada.')
    symbolic_public = require(call(admin_b, peer_base,
                                   f'/api/v1/public/sessions/{symbolic_session}?tenant=staging-example'),
                              200, 'portal simbólico por B')
    if (symbolic_public['votings'][0]['resultStatus'] != 'empate' or
            symbolic_public['votings'][0]['resultCounts'] != symbolic_expected):
        raise RuntimeError('Portal simbólico divergiu da revisão confirmada.')
    require(call(admin_a, BASE, f'/api/v1/sessions/{symbolic_session}/transition',
                 {'action': 'close', 'version': 4}), 200, 'encerrar sessão simbólica')
    print(json.dumps({'ok': True, 'synthetic': True, 'sameHost': True,
                      'appContainers': 2, 'votes': votes, 'receipts': receipts,
                      'auditEvents': audits, 'duplicateStatuses': duplicate_statuses,
                      'closeStatuses': close_statuses, 'resultStatus': status,
                      'counts': counts, 'symbolicOfficialFixture': True,
                      'symbolicRevisionCount': int(revision_count),
                      'symbolicTallyAuditEvents': 2,
                      'symbolicProposalStatuses': proposal_statuses,
                      'symbolicCloseStatuses': symbolic_close,
                      'symbolicResultStatus': symbolic_status,
                      'symbolicCounts': symbolic_counts}, sort_keys=True))
finally:
    try:
        for session_id in session_ids:
            if not re.fullmatch(r'[a-zA-Z0-9_-]+', session_id):
                continue
            # Se o ensaio falhar, não deixe uma sessão fictícia ativa na stack.
            query(f"UPDATE \"Voting\" SET status='cancelled' WHERE \"sessionId\"='{session_id}' AND status IN ('ready','open','paused')")
            query(f"UPDATE \"Session\" SET status='closed', \"closedAt\"=now() WHERE id='{session_id}' AND status IN ('check_in','open','suspended','resumed')")
    finally:
        subprocess.run(['docker', 'rm', '-f', name], cwd=ROOT, stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL, check=False)
