#!/usr/bin/env python3
"""Versioned PostgreSQL SQL runner. URL is supplied only via environment."""
import argparse
import hashlib
import os
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import parse_qs, unquote, urlsplit


ROOT = Path(__file__).resolve().parent.parent
MIGRATIONS = ROOT / 'prisma/postgres/migrations'
ROLLBACK_0002 = ROOT / 'prisma/postgres/rollback/0002_delivery_indexes.sql'
LOCK_KEY = 736822041
HISTORY = '"_edocbr_schema_migration"'


def connection_env() -> dict[str, str]:
    raw = os.environ.get('POSTGRES_MIGRATION_URL', '')
    parsed = urlsplit(raw)
    if parsed.scheme not in ('postgres', 'postgresql') or not parsed.hostname or not parsed.path.strip('/'):
        raise ValueError('POSTGRES_MIGRATION_URL deve ser uma URL PostgreSQL válida')
    env = os.environ.copy()
    env.update(PGHOST=parsed.hostname, PGPORT=str(parsed.port or 5432),
               PGDATABASE=unquote(parsed.path.lstrip('/')), PGUSER=unquote(parsed.username or ''),
               PGPASSWORD=unquote(parsed.password or ''))
    options = parse_qs(parsed.query)
    if 'sslmode' in options:
        env['PGSSLMODE'] = options['sslmode'][0]
    env.pop('POSTGRES_MIGRATION_URL', None)
    return env


def psql(env: dict[str, str], *, sql: str | None = None, file: Path | None = None,
         atomic: bool = False) -> str:
    command = ['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1']
    if atomic:
        command.append('--single-transaction')
    if sql is not None:
        command.extend(['-c', sql])
    if file is not None:
        command.extend(['-f', str(file)])
    result = subprocess.run(command, env=env, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or 'psql falhou')
    return result.stdout.strip()


def lock(env: dict[str, str]) -> subprocess.Popen[str]:
    lock_env = {**env, 'PGOPTIONS': '-c statement_timeout=30000'}
    process = subprocess.Popen(['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'],
                               env=lock_env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, text=True, bufsize=1)
    assert process.stdin is not None and process.stdout is not None
    process.stdin.write(f"SELECT pg_advisory_lock({LOCK_KEY}); SELECT 'LOCKED';\n")
    process.stdin.flush()
    line = ''
    while line != 'LOCKED':
        line = process.stdout.readline().strip()
        if not line and process.poll() is not None:
            break
    if line != 'LOCKED':
        error = process.stderr.read() if process.stderr else ''
        process.kill()
        raise RuntimeError(f'não foi possível obter bloqueio PostgreSQL: {error.strip()}')
    return process


def unlock(process: subprocess.Popen[str]) -> None:
    try:
        assert process.stdin is not None
        process.stdin.write(f'SELECT pg_advisory_unlock({LOCK_KEY});\n\\q\n')
        process.stdin.flush()
        process.communicate(timeout=5)
    except (BrokenPipeError, subprocess.TimeoutExpired):
        process.kill()
        process.communicate()


def migration_files() -> list[Path]:
    files = sorted(MIGRATIONS.glob('*.sql'))
    if not files or any(not re.fullmatch(r'[0-9]{4}_[a-z0-9_]+', file.stem) for file in files):
        raise ValueError('nomes de migração inválidos ou ausentes')
    return files


def checksum(file: Path) -> str:
    return hashlib.sha256(file.read_bytes()).hexdigest()


def history_exists(env: dict[str, str]) -> bool:
    return psql(env, sql="SELECT to_regclass('public._edocbr_schema_migration') IS NOT NULL") == 't'


def read_history(env: dict[str, str]) -> dict[str, tuple[str, str]]:
    if not history_exists(env):
        return {}
    rows = psql(env, sql=f'SELECT version, checksum, status FROM {HISTORY} ORDER BY version')
    return {parts[0]: (parts[1], parts[2]) for line in rows.splitlines() if (parts := line.split('|')) and len(parts) == 3}


def set_status(env: dict[str, str], version: str, digest: str, status: str) -> None:
    # Values originate only from validated repo filenames, SHA-256, and fixed states.
    psql(env, sql=f"INSERT INTO {HISTORY} (version, checksum, status, started_at) "
                  f"VALUES ('{version}', '{digest}', '{status}', now()) "
                  f"ON CONFLICT (version) DO UPDATE SET checksum=EXCLUDED.checksum, "
                  f"status=EXCLUDED.status, started_at=now(), "
                  f"finished_at=NULL")


def apply(env: dict[str, str]) -> None:
    guard = lock(env)
    try:
        psql(env, sql=f'''CREATE TABLE IF NOT EXISTS {HISTORY} (
          version TEXT PRIMARY KEY, checksum TEXT NOT NULL,
          status TEXT NOT NULL, started_at TIMESTAMPTZ NOT NULL,
          finished_at TIMESTAMPTZ
        )''')
        history = read_history(env)
        for file in migration_files():
            version, digest = file.stem, checksum(file)
            prior = history.get(version)
            if prior and prior[0] != digest:
                raise RuntimeError(f'checksum alterado para {version}; não editar migração aplicada')
            if prior and prior[1] == 'applied':
                print(f'{version}: já aplicada')
                continue
            if prior and prior[1] in ('failed', 'running'):
                raise RuntimeError(f'{version}: estado {prior[1]}; reparar ou restaurar antes de continuar')
            if version.startswith('0001_'):
                tables = int(psql(env, sql=f"SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename <> '_edocbr_schema_migration'"))
                if tables:
                    raise RuntimeError('baseline 0001 exige banco sem tabelas da aplicação')
            set_status(env, version, digest, 'running')
            try:
                psql(env, file=file, atomic=version.startswith('0001_'))
            except Exception:
                psql(env, sql=f"UPDATE {HISTORY} SET status='failed', finished_at=now() WHERE version='{version}'")
                raise
            psql(env, sql=f"UPDATE {HISTORY} SET status='applied', finished_at=now() WHERE version='{version}'")
            history[version] = (digest, 'applied')
            print(f'{version}: aplicada')
    finally:
        unlock(guard)


def rollback_indexes(env: dict[str, str]) -> None:
    guard = lock(env)
    try:
        history = read_history(env)
        version = '0002_delivery_indexes'
        if history.get(version) != (checksum(MIGRATIONS / f'{version}.sql'), 'applied'):
            raise RuntimeError('0002 não está aplicada com o checksum esperado')
        psql(env, file=ROLLBACK_0002)
        psql(env, sql=f"UPDATE {HISTORY} SET status='rolled_back', finished_at=now() WHERE version='{version}'")
        print('0002_delivery_indexes: revertida')
    finally:
        unlock(guard)


def main() -> None:
    parser = argparse.ArgumentParser(description='Migrações PostgreSQL versionadas do edocBR Plenário')
    parser.add_argument('command', choices=['status', 'apply', 'rollback-indexes'])
    args = parser.parse_args()
    env = connection_env()
    if args.command == 'status':
        history = read_history(env)
        for file in migration_files():
            digest = checksum(file)
            prior = history.get(file.stem)
            print(f'{file.stem}: {prior[1] if prior else "pending"}' + (' (checksum divergente)' if prior and prior[0] != digest else ''))
    elif args.command == 'apply':
        apply(env)
    else:
        rollback_indexes(env)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, RuntimeError, FileNotFoundError) as error:
        print(f'Erro: {error}', file=sys.stderr)
        sys.exit(1)
