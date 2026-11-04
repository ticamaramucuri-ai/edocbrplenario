"""Votação nominal sintética contínua durante um cenário de falha local."""
from datetime import datetime, timedelta, timezone
import http.cookiejar
import json
import subprocess
import threading
from urllib.error import HTTPError, URLError
from urllib.request import HTTPCookieProcessor, Request, build_opener
from uuid import uuid4


def client():
    return build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))


def call(opener, base: str, path: str, payload: dict, timeout=12) -> tuple[int, dict]:
    request = Request(base + path, json.dumps(payload).encode(),
                      {'Content-Type': 'application/json'})
    try:
        with opener.open(request, timeout=timeout) as response:
            return response.status, json.load(response)
    except HTTPError as error:
        try:
            body = json.load(error)
        except (ValueError, TypeError):
            body = {}
        return error.code, body
    except (OSError, URLError, TimeoutError):
        return 0, {}


def query(env: dict[str, str], sql: str) -> str:
    result = subprocess.run(['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', sql],
                            env=env, capture_output=True, text=True, check=True)
    return result.stdout.strip()


class VoteProbe:
    def __init__(self, base: str, values: dict[str, str], env: dict[str, str],
                 admin, label: str):
        self.base, self.env, self.admin = base, env, admin
        self.operator = client()
        self.stop_event = threading.Event()
        self.ready = threading.Event()
        self.samples: list[int] = []
        self.thread: threading.Thread | None = None
        self.finished = False
        tenant_id = query(env, "SELECT id FROM \"Tenant\" WHERE slug='staging-example'")
        operator_email = 'stage-vote-operator@example.invalid'
        role = query(env, f"SELECT role FROM \"User\" WHERE email='{operator_email}'")
        if role not in ('', 'session_operator'):
            raise RuntimeError('Operador sintético pertence a outro papel.')
        if not role:
            query(env, 'INSERT INTO "User" (id, "tenantId", name, email, role, '
                  '"passwordHash", active, "createdAt", "updatedAt") '
                  f"SELECT 'stage-vote-operator', '{tenant_id}', 'Operador Sintético', "
                  f"'{operator_email}', 'session_operator', \"passwordHash\", true, now(), now() "
                  "FROM \"User\" WHERE email='stage-admin@example.invalid' "
                  f"AND NOT EXISTS (SELECT 1 FROM \"User\" WHERE email='{operator_email}')")
        status, body = call(self.operator, base, '/api/v1/auth/login',
                            {'email': operator_email,
                             'password': values['STAGE_ADMIN_PASSWORD']})
        if status != 200 or body.get('actor', {}).get('role') != 'session_operator':
            raise RuntimeError('Login do operador sintético falhou.')
        members = query(env, f'SELECT id FROM "Parliamentarian" WHERE '
                        f'"tenantId"=\'{tenant_id}\' AND active=true ORDER BY id LIMIT 7').splitlines()
        if len(members) != 7 or any(not member.isalnum() for member in members):
            raise RuntimeError('São necessários sete parlamentares sintéticos ativos.')

        def expect(path: str, payload: dict, expected: int) -> dict:
            actual, result = call(admin, base, path, payload)
            if actual != expected:
                raise RuntimeError(f'Preparação da votação: {path} respondeu HTTP {actual}.')
            return result

        session = expect('/api/v1/sessions', {
            'type': 'ordinaria', 'official': False,
            'scheduledAt': (datetime.now(timezone.utc) + timedelta(days=60)).isoformat(),
            'presidentId': members[0], 'notes': f'Matriz sintética {label} {uuid4().hex}'}, 201)
        self.session_id = session['session']['id']
        for action, version in [('schedule', 1), ('open_checkin', 2)]:
            expect(f'/api/v1/sessions/{self.session_id}/transition',
                   {'action': action, 'version': version}, 200)
        for member in members:
            expect(f'/api/v1/sessions/{self.session_id}/attendance',
                   {'parliamentarianId': member, 'action': 'check_in',
                    'commandId': str(uuid4())}, 200)
        expect(f'/api/v1/sessions/{self.session_id}/transition',
               {'action': 'open_session', 'version': 3}, 200)
        voting = expect(f'/api/v1/sessions/{self.session_id}/votings',
                        {'question': f'Matriz sintética {label}: aprovar?',
                         'mode': 'nominal'}, 201)
        self.voting_id = voting['voting']['id']
        expect(f'/api/v1/votings/{self.voting_id}/transition',
               {'action': 'open', 'version': 1}, 200)
        self.commands = [{'parliamentarianId': member, 'value': 'sim',
                          'commandId': str(uuid4())} for member in members]

    def start(self) -> None:
        def loop():
            while not self.stop_event.is_set():
                for command in self.commands:
                    if self.stop_event.is_set():
                        return
                    status, _ = call(self.operator, self.base,
                                     f'/api/v1/votings/{self.voting_id}/votes', command)
                    self.samples.append(status)
                    self.ready.set()
                    self.stop_event.wait(0.05)
        self.thread = threading.Thread(target=loop, daemon=True)
        self.thread.start()
        if not self.ready.wait(10):
            raise RuntimeError('Carga de voto não iniciou antes da falha.')

    def finish(self, scenario: str) -> dict:
        self.stop_event.set()
        if self.thread:
            self.thread.join(timeout=15)
            if self.thread.is_alive():
                raise RuntimeError('Carga de voto não encerrou após a falha.')
        statuses: dict[str, int] = {}
        for status in self.samples:
            key = str(status)
            statuses[key] = statuses.get(key, 0) + 1
        if len(self.samples) < 2 or not statuses.get('200'):
            raise RuntimeError('Carga de voto não teve respostas suficientes.')
        degraded = sum(count for status, count in statuses.items() if status != '200')
        if scenario in ('postgres', 'app_db_network'):
            if degraded == 0 or any(status not in ('200', '503', '0') for status in statuses):
                raise RuntimeError('Voto não observou degradação esperada do banco.')
        elif degraded:
            raise RuntimeError('Voto falhou durante indisponibilidade de outro serviço.')
        for command in self.commands:
            status, _ = call(self.operator, self.base,
                             f'/api/v1/votings/{self.voting_id}/votes', command)
            if status != 200:
                raise RuntimeError(f'Repetição idempotente de voto respondeu HTTP {status}.')
        status, _ = call(self.admin, self.base,
                         f'/api/v1/votings/{self.voting_id}/transition',
                         {'action': 'close', 'version': 2})
        if status != 200:
            raise RuntimeError(f'Encerramento da votação sintética respondeu HTTP {status}.')
        vote_count = int(query(self.env, f"SELECT count(*) FROM \"Vote\" WHERE \"votingId\"='{self.voting_id}'"))
        receipt_count = int(query(self.env, f"SELECT count(*) FROM \"VoteReceipt\" WHERE \"votingId\"='{self.voting_id}'"))
        audit_count = int(query(self.env, f"SELECT count(*) FROM \"AuditEvent\" WHERE \"aggregateId\"='{self.voting_id}' AND action='vote.cast'"))
        if (vote_count, receipt_count, audit_count) != (7, 7, 7):
            raise RuntimeError('Voto, recibo e auditoria divergiram na carga contínua.')
        status, _ = call(self.admin, self.base,
                         f'/api/v1/sessions/{self.session_id}/transition',
                         {'action': 'close', 'version': 4})
        if status != 200:
            raise RuntimeError(f'Encerramento da sessão sintética respondeu HTTP {status}.')
        self.finished = True
        return {'requests': len(self.samples), 'statusCounts': statuses,
                'degradedResponses': degraded, 'votes': vote_count,
                'receipts': receipt_count, 'auditEvents': audit_count,
                'idempotentReplayVerified': True, 'sessionId': self.session_id}

    def stop(self) -> None:
        self.stop_event.set()
        if self.thread:
            self.thread.join(timeout=15)
        if not self.finished:
            # Melhor esforço após falha da matriz: não deixar ato sintético aberto.
            call(self.admin, self.base, f'/api/v1/votings/{self.voting_id}/transition',
                 {'action': 'close', 'version': 2}, timeout=3)
            call(self.admin, self.base, f'/api/v1/sessions/{self.session_id}/transition',
                 {'action': 'close', 'version': 4}, timeout=3)
