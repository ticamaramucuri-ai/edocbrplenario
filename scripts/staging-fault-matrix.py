#!/usr/bin/env python3
"""Executa os cinco cenários locais da matriz 045 na stack sintética exclusiva.

Não reinicia o host e não constitui prova com observador externo. Cada cenário
usa seu roteiro próprio, com restauração em finally. O resultado é JSON.
"""
import argparse
from datetime import datetime, timezone
import http.cookiejar
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.request import HTTPCookieProcessor, Request, build_opener, urlopen
from staging_vote_probe import VoteProbe

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / 'deploy/staging/.env'
COMPOSE = ROOT / 'deploy/staging/compose.yaml'
SCENARIOS = {
    'realtime': ['python3', 'scripts/staging-realtime-write-fault.py'],
    'redis': ['bun', 'scripts/staging-realtime-fanout.ts'],
    'mail': ['python3', 'scripts/staging-mail-drill.py'],
    'postgres': ['python3', 'scripts/staging-db-outage-drill.py'],
    'app_db_network': ['python3', 'scripts/staging-db-network-drill.py'],
}


def valid_evidence(name: str, proof: dict) -> bool:
    if proof.get('ok') is not True:
        return False
    if name == 'realtime':
        return (proof.get('votes', 0) > 0 and proof.get('votes') == proof.get('receipts')
                and proof.get('pendingDuringOutage', 0) > 0
                and proof.get('appAvailableDuringOutage') is True)
    if name == 'redis':
        return (proof.get('nodes') == 2 and proof.get('subscribers') == 4
                and proof.get('isolatedPublicPayload') is True
                and proof.get('redisOutageHeldOutbox') is True
                and proof.get('redisRecoveryDeliveredToAll') is True)
    if name == 'mail':
        return (proof.get('retryAttempts') == 2 and proof.get('networkRetryAttempts') == 2
                and proof.get('retryDelivery') == 'sent'
                and proof.get('networkRetryDelivery') == 'sent'
                and proof.get('workerOutageHeldQueue') is True
                and proof.get('workerRecoveryDelivery') == 'sent'
                and proof.get('workerRecoveryAttempts') == 1
                and proof.get('workerRecoveryMessageCount') == 1
                and proof.get('externalDelivery') is False)
    if name == 'postgres':
        return (proof.get('outageHttpStatus') != 200
                and proof.get('syntheticReplayRetained') is True
                and proof.get('before', {}).get('errors') == 0
                and proof.get('after', {}).get('errors') == 0)
    if name == 'app_db_network':
        return (proof.get('postgresStayedUp') is True
                and proof.get('appPortRemainedOpen') is True
                and proof.get('outageReadinessStatus') == 503
                and proof.get('outageVoteStatuses') == [503] * 7
                and proof.get('voteIdempotencyVerified') is True
                and proof.get('voteReceiptVerified') is True
                and proof.get('auditEventsVerified') is True
                and proof.get('incidentTransitionsVerified') is True)
    return False


def run(command: list[str], *, env=None, timeout=240) -> subprocess.CompletedProcess:
    return subprocess.run(command, cwd=ROOT, env=env, capture_output=True,
                          text=True, timeout=timeout)


def compose(*args: str) -> subprocess.CompletedProcess:
    return run(['docker', 'compose', '--profile', 'mail-lab', '--env-file',
                str(CONFIG), '-f', str(COMPOSE), *args], timeout=120)


def probe(url: str, timeout=5) -> bool:
    try:
        with urlopen(url, timeout=timeout) as response:
            return response.status == 200
    except OSError:
        return False


def wait_for(url: str, label: str, seconds=60) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if probe(url):
            return
        time.sleep(1)
    raise RuntimeError(f'{label} não respondeu em {seconds} s.')


def public_read(url: str) -> tuple[int, bool]:
    try:
        with urlopen(url, timeout=3) as response:
            status = response.status
            if status != 200:
                return status, True
            try:
                body = json.load(response)
                return 200, isinstance(body, dict) and isinstance(body.get('sessions'), list)
            except (ValueError, TypeError):
                return 200, False
    except HTTPError as error:
        error.close()
        return error.code, True
    except (OSError, URLError):
        return 0, False


def observe_public_reads(url: str, stop: threading.Event, ready: threading.Event,
                         samples: list[tuple[int, bool]]) -> None:
    while not stop.is_set():
        samples.append(public_read(url))
        ready.set()
        stop.wait(0.25)


def summarize_public_reads(name: str, samples: list[tuple[int, bool]]) -> dict:
    statuses: dict[str, int] = {}
    for status, _ in samples:
        key = str(status)
        statuses[key] = statuses.get(key, 0) + 1
    invalid = sum(status == 200 and not valid for status, valid in samples)
    healthy = statuses.get('200', 0)
    degraded = len(samples) - healthy
    return {'requests': len(samples), 'statusCounts': statuses,
            'invalidSuccessfulPayloads': invalid,
            'healthyResponses': healthy, 'degradedResponses': degraded,
            'expectedBehaviorObserved': (len(samples) >= 2 and invalid == 0 and healthy > 0
                                         and (degraded > 0 if name in ('postgres', 'app_db_network')
                                              else degraded == 0))}


def preflight() -> tuple[dict[str, str], dict[str, str]]:
    if not CONFIG.is_file() or CONFIG.is_symlink() or stat.S_IMODE(CONFIG.stat().st_mode) & 0o077:
        raise RuntimeError('Arquivo privado da stack sintética ausente ou inseguro.')
    values = dict(line.split('=', 1) for line in CONFIG.read_text().splitlines()
                  if '=' in line and not line.startswith('#'))
    env = {**os.environ, 'PGHOST': '127.0.0.1',
           'PGPORT': values.get('STAGE_DB_PORT', '55432'),
           'PGUSER': 'edocbr_stage', 'PGDATABASE': 'edocbr_stage',
           'PGPASSWORD': values['STAGE_DB_PASSWORD']}
    tenant = run(['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c',
                  'SELECT slug FROM "Tenant" ORDER BY slug'], env=env, timeout=15)
    if tenant.returncode or tenant.stdout.splitlines() != ['staging-example']:
        raise RuntimeError('Matriz recusada: banco deve conter apenas staging-example.')
    for service in ('app', 'postgres', 'redis', 'realtime', 'webhooks', 'scheduler'):
        result = compose('ps', '-q', service)
        if result.returncode or not result.stdout.strip():
            raise RuntimeError(f'Serviço sintético ausente: {service}.')
    app_url = f"http://127.0.0.1:{values.get('STAGE_APP_PORT', '3100')}"
    wait_for(app_url + '/api/v1/health?ready=1', 'App pronto')
    with urlopen(app_url + '/api/v1/bootstrap', timeout=5) as response:
        bootstrap = json.load(response)
    if bootstrap.get('tenant', {}).get('slug') != 'staging-example':
        raise RuntimeError('App não aponta para a Câmara sintética exclusiva.')
    return values, env


def authenticated_client(app_url: str, values: dict[str, str]):
    client = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))
    payload = json.dumps({'email': 'stage-admin@example.invalid',
                          'password': values['STAGE_ADMIN_PASSWORD']}).encode()
    request = Request(app_url + '/api/v1/auth/login', payload,
                      {'Content-Type': 'application/json'})
    with client.open(request, timeout=10) as response:
        actor = json.load(response).get('actor', {})
    if actor.get('role') != 'tenant_admin':
        raise RuntimeError('Login sintético não confirmou o administrador.')
    return client


def post_invariants(client, app_url: str, env: dict[str, str]) -> dict:
    sql = ('SELECT count(*) FROM "OutboxEvent" WHERE status=\'pending\' AND '
           '"tenantId"=(SELECT id FROM "Tenant" WHERE slug=\'staging-example\')')
    deadline = time.monotonic() + 45
    while True:
        pending = run(['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', sql],
                      env=env, timeout=10)
        if pending.returncode or not pending.stdout.strip().isdigit():
            raise RuntimeError('Não foi possível conferir a outbox sintética.')
        count = int(pending.stdout.strip())
        if count == 0:
            break
        if time.monotonic() >= deadline:
            raise RuntimeError(f'Outbox não drenou: {count} evento(s) pendente(s).')
        time.sleep(0.5)
    with client.open(app_url + '/api/v1/audit?verify=true&limit=1', timeout=30) as response:
        chain = json.load(response).get('chain', {})
    if chain.get('valid') is not True or not chain.get('head'):
        raise RuntimeError('Cadeia de auditoria sintética inválida ou ausente.')
    return {'outboxPending': 0, 'auditChainValid': True, 'auditHead': chain['head']}


def ensure_mail_lab(values: dict[str, str]) -> bool:
    mail_url = f"http://127.0.0.1:{values.get('STAGE_MAILPIT_PORT', '3125')}/api/v1/messages"
    worker = compose('ps', '-q', 'mail_worker')
    already_running = bool(worker.stdout.strip()) and probe(mail_url)
    if already_running:
        return False
    # Contêineres parados podem guardar o ID de uma rede Docker já recriada.
    # Remove apenas os dois contêineres sintéticos; o volume mailpit_data fica.
    removed = compose('rm', '-s', '-f', 'mail_worker', 'mailpit')
    if removed.returncode:
        raise RuntimeError('Não foi possível remover contêineres antigos do correio sintético.')
    setup = run(['bash', 'scripts/staging-mail-lab-setup.sh'], timeout=30)
    if setup.returncode:
        raise RuntimeError('Preparação do laboratório de correio falhou.')
    started = compose('up', '-d', '--no-build', 'mailpit', 'mail_worker')
    if started.returncode:
        compose('stop', 'mail_worker', 'mailpit')
        raise RuntimeError('Não foi possível iniciar o laboratório de correio.')
    try:
        wait_for(mail_url, 'Capturador local de correio')
    except RuntimeError:
        compose('stop', 'mail_worker', 'mailpit')
        raise
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--only', choices=tuple(SCENARIOS), action='append',
                        help='cenário local; pode repetir (padrão: todos)')
    parser.add_argument('--output', type=Path, help='arquivo da prova JSON')
    args = parser.parse_args()
    selected = list(dict.fromkeys(args.only or SCENARIOS))
    values, env = preflight()
    app_url = f"http://127.0.0.1:{values.get('STAGE_APP_PORT', '3100')}"
    client = authenticated_client(app_url, values)
    post_invariants(client, app_url, env)
    report = {'schemaVersion': 2, 'scope': 'synthetic-staging',
              'at': datetime.now(timezone.utc).isoformat(),
              'buildVersion': values.get('STAGE_BUILD_VERSION', 'local-unversioned'),
              'remoteObserver': False, 'hostRestartExecuted': False,
              'scenarios': []}
    mail_started = False
    try:
        for name in selected:
            began = time.monotonic()
            stop = threading.Event()
            ready = threading.Event()
            samples: list[tuple[int, bool]] = []
            observer = None
            vote_probe = None
            vote_evidence = None
            try:
                if name == 'mail':
                    mail_started = ensure_mail_lab(values)
                vote_probe = VoteProbe(app_url, values, env, client, name)
                vote_probe.start()
                observer = threading.Thread(target=observe_public_reads,
                                            args=(app_url + '/api/v1/public/sessions?tenant=staging-example',
                                                  stop, ready, samples), daemon=True)
                observer.start()
                if not ready.wait(5):
                    raise RuntimeError('Leitor público não iniciou antes da falha.')
                result = run(SCENARIOS[name], timeout=300)
                payload = json.loads(result.stdout.splitlines()[-1]) if result.stdout.strip() else {}
                passed = result.returncode == 0 and valid_evidence(name, payload)
                if passed:
                    wait_for(app_url + '/api/v1/health?ready=1', 'App após ' + name)
                    vote_evidence = vote_probe.finish(name)
                    integrity = post_invariants(client, app_url, env)
            except (subprocess.TimeoutExpired, subprocess.CalledProcessError,
                    ValueError, IndexError, KeyError, RuntimeError, OSError) as error:
                passed = False
                payload = None
                failure = (str(error)[:200] if isinstance(error, RuntimeError)
                           else type(error).__name__)
            else:
                failure = None if passed else f'Roteiro falhou ou prova incompleta (exit {result.returncode})'
            finally:
                stop.set()
                if observer:
                    observer.join(timeout=5)
                if vote_probe:
                    vote_probe.stop()
            observation = summarize_public_reads(name, samples)
            if not observation['expectedBehaviorObserved']:
                passed = False
                failure = failure or 'Leitura pública não comprovou comportamento esperado.'
            entry = {'name': name, 'passed': passed,
                     'elapsedSeconds': round(time.monotonic() - began, 3),
                     'evidence': payload if passed else None,
                     'voteObservation': vote_evidence if passed else None,
                     'postIntegrity': integrity if passed else None,
                     'publicReadObservation': observation,
                     'error': failure}
            report['scenarios'].append(entry)
            if not entry['passed']:
                break
    finally:
        if mail_started:
            compose('stop', 'mail_worker', 'mailpit')
    report['ok'] = len(report['scenarios']) == len(selected) and all(
        entry['passed'] for entry in report['scenarios'])
    text = json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + '\n'
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text)
    print(text, end='')
    return 0 if report['ok'] else 1


if __name__ == '__main__':
    sys.exit(main())
