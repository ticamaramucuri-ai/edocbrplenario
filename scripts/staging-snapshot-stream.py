#!/usr/bin/env python3
"""Emit a CMS-encrypted snapshot of the synthetic staging stack on stdout.

Only staging-example is accepted. Writers are stopped for the database/files
snapshot and always restarted before encryption and transfer begin. Diagnostic
JSON is written to stderr; stdout contains only encrypted bytes.
"""

import argparse
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import time
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / 'deploy/staging/.env'
COMPOSE = ROOT / 'deploy/staging/compose.yaml'
WRITERS = ('app', 'realtime', 'webhooks', 'scheduler')


def run(*args: str, env=None, capture=False) -> str:
    result = subprocess.run(args, cwd=ROOT, env=env, check=True, text=True,
                            stdout=subprocess.PIPE if capture else subprocess.DEVNULL)
    return result.stdout.strip() if capture else ''


def compose(*args: str, capture=False) -> str:
    return run('docker', 'compose', '--env-file', str(CONFIG), '-f', str(COMPOSE),
               *args, capture=capture)


def private_config() -> dict[str, str]:
    if CONFIG.is_symlink() or not CONFIG.is_file() or stat.S_IMODE(CONFIG.stat().st_mode) & 0o077:
        raise RuntimeError('Configuração privada da staging ausente ou com permissões inseguras.')
    return dict(line.split('=', 1) for line in CONFIG.read_text().splitlines()
                if '=' in line and not line.startswith('#'))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cert', type=Path, required=True,
                        help='Certificado público X.509 do receptor, em caminho absoluto')
    args = parser.parse_args()
    cert = args.cert
    if not cert.is_absolute() or cert.is_symlink() or not cert.is_file():
        raise RuntimeError('Certificado público inválido.')
    values = private_config()
    env = {**os.environ, 'PGHOST': '127.0.0.1', 'PGPORT': values['STAGE_DB_PORT'],
           'PGUSER': 'edocbr_stage', 'PGPASSWORD': values['STAGE_DB_PASSWORD'],
           'PGDATABASE': 'edocbr_stage'}
    slugs = run('psql', '-X', '-qAt', '-c', 'SELECT slug FROM "Tenant" ORDER BY slug',
                env=env, capture=True).splitlines()
    if slugs != ['staging-example']:
        raise RuntimeError('Snapshot recusado: banco não contém apenas staging-example.')
    if int(run('psql', '-X', '-qAt', '-c', 'SELECT count(*) FROM "SessionRecording"',
               env=env, capture=True)) < 1:
        raise RuntimeError('Snapshot recusado: gravação sintética de referência ausente.')
    app = compose('ps', '-q', 'app', capture=True)
    postgres = compose('ps', '-q', 'postgres', capture=True)
    if not app or not postgres:
        raise RuntimeError('App e PostgreSQL da staging devem estar em execução.')

    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix='edocbr-stage-snapshot-') as temporary:
        work = Path(temporary)
        work.chmod(0o700)
        sources = work / 'sources'
        sources.mkdir(mode=0o700)
        stopped = False
        try:
            stopped = True
            compose('stop', *WRITERS)
            for name, location in [('images', '/data/images'), ('public', '/app/public'),
                                   ('recordings', '/data/recordings'), ('replay', '/data/replay')]:
                target = sources / name
                target.mkdir()
                run('docker', 'cp', f'{app}:{location}/.', str(target))
            password = quote(values['STAGE_DB_PASSWORD'], safe='')
            url = (f'postgresql://edocbr_stage:{password}@127.0.0.1:'
                   f'{values["STAGE_DB_PORT"]}/edocbr_stage')
            wrapper = work / 'pg-dump-16.sh'
            wrapper.write_text('#!/bin/sh\nset -eu\n'
                               f'docker exec {postgres} pg_dump -U edocbr_stage -d edocbr_stage -Fc > "$3"\n')
            wrapper.chmod(0o700)
            backup_env = {**os.environ, 'POSTGRES_BACKUP_URL': url,
                          'POSTGRES_DUMP_BIN': str(wrapper)}
            bundle = work / 'bundle'
            proof = json.loads(run('python3', 'scripts/backup-bundle.py', 'create',
                                   '--database', 'postgresql', '--output', str(bundle),
                                   *[part for name in ('images', 'public', 'recordings', 'replay')
                                     for part in (f'--{name}-root', str(sources / name))],
                                   env=backup_env, capture=True))
        finally:
            if stopped:
                compose('up', '-d', '--no-build', *WRITERS)
        snapshot_seconds = round(time.monotonic() - started, 3)
        print(json.dumps({'scope': 'synthetic-staging', 'files': proof['files'],
                          'manifestSha256': proof['manifestSha256'],
                          'snapshotSeconds': snapshot_seconds}), file=sys.stderr)
        # Tar is streamed directly to OpenSSL; no plaintext archive persists.
        tar = subprocess.Popen(['tar', '-C', str(work), '-cf', '-', 'bundle'], stdout=subprocess.PIPE)
        try:
            encrypted = subprocess.run(['openssl', 'cms', '-encrypt', '-binary',
                                        '-aes-256-cbc', '-outform', 'DER', str(cert)],
                                       stdin=tar.stdout, stdout=sys.stdout.buffer, check=False)
        finally:
            if tar.stdout:
                tar.stdout.close()
        tar_code = tar.wait()
        if encrypted.returncode or tar_code:
            raise RuntimeError('Falhou a cifragem ou o streaming do pacote.')


if __name__ == '__main__':
    main()
