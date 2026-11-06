#!/usr/bin/env python3
"""PostgreSQL persistente de homologação local; nunca toca o SQLite ativo."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import secrets
import stat
import subprocess
import time
from urllib.parse import quote
from uuid import uuid4

ROOT = Path(__file__).resolve().parent.parent
STAGING = ROOT / 'deploy/staging'
CONFIG = STAGING / '.env'
COMPOSE = STAGING / 'compose.yaml'


def private_config(create: bool) -> dict[str, str]:
    if CONFIG.is_symlink():
        raise RuntimeError('Arquivo privado de homologação não pode ser symlink.')
    if not CONFIG.exists():
        if not create:
            raise RuntimeError('Homologação não inicializada. Execute: python3 scripts/staging-postgres.py up')
        descriptor = os.open(CONFIG, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, 'w') as stream:
            stream.write(f'STAGE_DB_PASSWORD={secrets.token_urlsafe(36)}\nSTAGE_DB_PORT=55432\n')
    mode = stat.S_IMODE(CONFIG.stat().st_mode)
    if mode & 0o077:
        raise RuntimeError('Arquivo deploy/staging/.env deve permitir leitura somente ao proprietário (chmod 600).')
    values = {}
    for line in CONFIG.read_text().splitlines():
        if '=' in line and not line.startswith('#'):
            key, value = line.split('=', 1)
            values[key] = value
    if not values.get('STAGE_DB_PASSWORD') or not values.get('STAGE_DB_PORT', '').isdigit():
        raise RuntimeError('Arquivo privado de homologação inválido.')
    port = int(values['STAGE_DB_PORT'])
    if port < 1 or port > 65535:
        raise RuntimeError('STAGE_DB_PORT inválida.')
    if create and not values.get('STAGE_REALTIME_SECRET'):
        values['STAGE_REALTIME_SECRET'] = secrets.token_urlsafe(48)
        with CONFIG.open('a') as stream:
            stream.write(f"STAGE_REALTIME_SECRET={values['STAGE_REALTIME_SECRET']}\n")
    if create and not values.get('STAGE_ADMIN_PASSWORD'):
        values['STAGE_ADMIN_PASSWORD'] = secrets.token_urlsafe(24)
        with CONFIG.open('a') as stream:
            stream.write(f"STAGE_ADMIN_PASSWORD={values['STAGE_ADMIN_PASSWORD']}\n")
    if create and not values.get('STAGE_MONITOR_PASSWORD'):
        values['STAGE_MONITOR_PASSWORD'] = secrets.token_urlsafe(24)
        with CONFIG.open('a') as stream:
            stream.write(f"STAGE_MONITOR_PASSWORD={values['STAGE_MONITOR_PASSWORD']}\n")
    return values


def compose(*args: str) -> None:
    subprocess.run(['docker', 'compose', '--env-file', str(CONFIG), '-f', str(COMPOSE), *args],
                   check=True, cwd=ROOT)


def pg_environment(config: dict[str, str]) -> dict[str, str]:
    return {**os.environ, 'PGHOST': '127.0.0.1', 'PGPORT': config['STAGE_DB_PORT'],
            'PGUSER': 'edocbr_stage', 'PGDATABASE': 'edocbr_stage',
            'PGPASSWORD': config['STAGE_DB_PASSWORD']}


def query(config: dict[str, str], sql: str) -> str:
    result = subprocess.run(['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', sql],
                            env=pg_environment(config), capture_output=True, text=True, check=True)
    return result.stdout.strip()


def await_connection(config: dict[str, str]) -> None:
    for _ in range(40):
        try:
            if query(config, 'SELECT 1') == '1':
                return
        except subprocess.CalledProcessError:
            time.sleep(0.5)
    raise RuntimeError('PostgreSQL de homologação não respondeu em 20 segundos.')


def status(config: dict[str, str]) -> dict:
    await_connection(config)
    applied = query(config, "SELECT count(*) FROM public._edocbr_schema_migration WHERE status='applied'")
    return {'scope': 'local-persistent-staging', 'checkedAt': datetime.now(timezone.utc).isoformat(),
            'database': 'postgresql',
            'host': '127.0.0.1', 'port': int(config['STAGE_DB_PORT']),
            'appliedMigrations': int(applied), 'persistentVolume': 'edocbr-plenario-staging_postgres_data',
            'sqliteCutoverPerformed': False}


def migrate(config: dict[str, str]) -> None:
    password = quote(config['STAGE_DB_PASSWORD'], safe='')
    url = f"postgresql://edocbr_stage:{password}@127.0.0.1:{config['STAGE_DB_PORT']}/edocbr_stage"
    subprocess.run(['python3', str(ROOT / 'scripts/postgres-migrate.py'), 'apply'], check=True,
                   cwd=ROOT, env={**os.environ, 'POSTGRES_MIGRATION_URL': url})


def restart_proof(config: dict[str, str]) -> dict:
    await_connection(config)
    marker = str(uuid4())
    query(config, 'CREATE TABLE IF NOT EXISTS public._edocbr_stage_probe (id text PRIMARY KEY)')
    query(config, f"INSERT INTO public._edocbr_stage_probe (id) VALUES ('{marker}')")
    started = time.monotonic()
    try:
        compose('restart', 'postgres')
        await_connection(config)
        if query(config, f"SELECT count(*) FROM public._edocbr_stage_probe WHERE id='{marker}'") != '1':
            raise RuntimeError('Marcador de persistência não sobreviveu ao reinício.')
    finally:
        query(config, 'DROP TABLE IF EXISTS public._edocbr_stage_probe')
    return {**status(config), 'restartPersistenceVerified': True,
            'restartAndQuerySeconds': round(time.monotonic() - started, 3)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['up', 'status', 'restart-proof', 'stop',
                                            'stack-up', 'stack-status', 'stack-stop'])
    args = parser.parse_args()
    if args.command == 'up':
        config = private_config(create=True)
        compose('up', '-d', '--wait', 'postgres')
        migrate(config)
        result = status(config)
    elif args.command == 'stack-up':
        config = private_config(create=True)
        compose('up', '-d', '--wait', 'postgres')
        migrate(config)
        subprocess.run(['python3', str(ROOT / 'scripts/staging-build.py')], check=True, cwd=ROOT)
        compose('up', '-d', '--no-build', 'app', 'realtime', 'webhooks', 'scheduler', 'gateway')
        subprocess.run(['docker', 'compose', '--env-file', str(CONFIG), '-f', str(COMPOSE),
                        'run', '--rm', '--no-deps', '-e', 'STAGING_SEED=synthetic-only',
                        '-e', 'STAGE_ADMIN_PASSWORD', '-e', 'STAGE_MONITOR_PASSWORD',
                        'app', 'bun', 'scripts/staging-seed.ts'],
                       check=True, cwd=ROOT,
                       env={**os.environ, 'STAGE_ADMIN_PASSWORD': config['STAGE_ADMIN_PASSWORD'],
                            'STAGE_MONITOR_PASSWORD': config['STAGE_MONITOR_PASSWORD']})
        result = {**status(config), 'stackStarted': True,
                  'appUrl': f"http://127.0.0.1:{config.get('STAGE_GATEWAY_PORT', '3181')}/",
                  'syntheticTenant': 'staging-example', 'adminEmail': 'stage-admin@example.invalid',
                  'observerEmail': 'stage-platform-observer@example.invalid'}
    elif args.command == 'stack-status':
        config = private_config(create=False)
        compose('ps')
        result = {**status(config), 'stackInspected': True}
    elif args.command == 'stack-stop':
        private_config(create=False)
        compose('stop', 'gateway', 'app', 'realtime', 'webhooks', 'scheduler')
        result = {'scope': 'local-persistent-staging', 'servicesStopped': True,
                  'postgresPreserved': True, 'volumesPreserved': True}
    elif args.command == 'stop':
        private_config(create=False)
        compose('stop', 'postgres')
        result = {'scope': 'local-persistent-staging', 'stopped': True, 'volumePreserved': True}
    else:
        config = private_config(create=False)
        result = status(config) if args.command == 'status' else restart_proof(config)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))


if __name__ == '__main__':
    main()
