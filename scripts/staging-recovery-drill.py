#!/usr/bin/env python3
"""Backup and restore the synthetic staging DB/assets into isolated targets."""
import hashlib
import argparse
import json
import os
from pathlib import Path
import secrets
import stat
import subprocess
import tempfile
import time
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / 'deploy/staging/.env'
COMPOSE = ROOT / 'deploy/staging/compose.yaml'
SERVICES = ('app', 'realtime', 'webhooks', 'scheduler')


def run(*args: str, env=None, capture=False) -> str:
    result = subprocess.run(args, cwd=ROOT, env=env, check=True, text=True,
                            stdout=subprocess.PIPE if capture else None)
    return result.stdout.strip() if capture else ''


def compose(*args: str, capture=False) -> str:
    return run('docker', 'compose', '--env-file', str(CONFIG), '-f', str(COMPOSE),
               *args, capture=capture)


def config() -> dict[str, str]:
    if CONFIG.is_symlink() or stat.S_IMODE(CONFIG.stat().st_mode) & 0o077:
        raise RuntimeError('Arquivo privado de homologação inválido.')
    return dict(line.split('=', 1) for line in CONFIG.read_text().splitlines()
                if '=' in line and not line.startswith('#'))


def pg_env(values: dict[str, str], database='edocbr_stage') -> dict[str, str]:
    return {**os.environ, 'PGHOST': '127.0.0.1', 'PGPORT': values['STAGE_DB_PORT'],
            'PGUSER': 'edocbr_stage', 'PGPASSWORD': values['STAGE_DB_PASSWORD'],
            'PGDATABASE': database}


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--require-media', action='store_true', help='Exige ao menos um replay vinculado ao banco')
    args = parser.parse_args()
    values = config()
    env = pg_env(values)
    slugs = run('psql', '-X', '-qAt', '-c', 'SELECT slug FROM "Tenant" ORDER BY slug',
                env=env, capture=True).splitlines()
    if slugs != ['staging-example']:
        raise RuntimeError('Ensaio recusado: a base deve conter apenas o tenant sintético staging-example.')
    app = compose('ps', '-q', 'app', capture=True)
    postgres = compose('ps', '-q', 'postgres', capture=True)
    if not app or not postgres:
        raise RuntimeError('Aplicação e PostgreSQL de homologação devem estar em execução.')

    started = time.monotonic()
    restored_db = 'edocbr_restore_' + secrets.token_hex(6)
    marker = 'staging-recovery-proof.txt'
    marker_bytes = secrets.token_bytes(128)
    digest = hashlib.sha256(marker_bytes).hexdigest()
    marker_paths = ['/data/images/' + marker, '/data/recordings/' + marker,
                    '/data/replay/' + marker]
    stopped = False
    database_created = False
    try:
        # Only the synthetic staging volumes are touched. Files are removed below.
        for path in marker_paths:
            subprocess.run(['docker', 'exec', '-i', app, 'sh', '-c',
                            f'cat > {path}'], input=marker_bytes, check=True)
        compose('stop', *SERVICES)
        stopped = True
        with tempfile.TemporaryDirectory(prefix='edocbr-stage-recovery-') as temporary:
            work = Path(temporary)
            sources = work / 'sources'
            sources.mkdir()
            for name, location in [('images', '/data/images'),
                                   ('public', '/app/public'),
                                   ('recordings', '/data/recordings'),
                                   ('replay', '/data/replay')]:
                target = sources / name
                target.mkdir()
                run('docker', 'cp', f'{app}:{location}/.', str(target))
            password = quote(values['STAGE_DB_PASSWORD'], safe='')
            url = f"postgresql://edocbr_stage:{password}@127.0.0.1:{values['STAGE_DB_PORT']}/edocbr_stage"
            bundle = work / 'bundle'
            dump_wrapper = work / 'pg-dump-16.sh'
            dump_wrapper.write_text('#!/bin/sh\nset -eu\n'
                                    f'docker exec {postgres} pg_dump -U edocbr_stage -d edocbr_stage -Fc > "$3"\n')
            dump_wrapper.chmod(0o700)
            backup_env = {**os.environ, 'POSTGRES_BACKUP_URL': url,
                          'POSTGRES_DUMP_BIN': str(dump_wrapper)}
            proof = json.loads(run('python3', 'scripts/backup-bundle.py', 'create',
                                   '--database', 'postgresql', '--output', str(bundle),
                                   *[value for name in ('images', 'public', 'recordings', 'replay')
                                     for value in (f'--{name}-root', str(sources / name))],
                                   env=backup_env, capture=True))
            snapshot_seconds = round(time.monotonic() - started, 3)
            restored = work / 'restored'
            run('python3', 'scripts/backup-bundle.py', 'restore-files',
                '--bundle', str(bundle), '--target', str(restored), capture=True)
            for name in ('images', 'recordings', 'replay'):
                if file_sha256(restored / name / marker) != digest:
                    raise RuntimeError(f'Arquivo restaurado divergiu: {name}')
            run('createdb', restored_db, env=env)
            database_created = True
            with (restored / 'database.dump').open('rb') as stream:
                subprocess.run(['docker', 'exec', '-i', postgres, 'pg_restore', '--exit-on-error',
                                '--no-owner', '--no-acl', '-U', 'edocbr_stage', '-d', restored_db],
                               stdin=stream, cwd=ROOT, check=True)
            restored_env = pg_env(values, restored_db)
            tenant_count = run('psql', '-X', '-qAt', '-c',
                               "SELECT count(*) FROM \"Tenant\" WHERE slug='staging-example'",
                               env=restored_env, capture=True)
            draft_count = run('psql', '-X', '-qAt', '-c',
                              'SELECT count(*) FROM "Session" WHERE "official"=false',
                              env=restored_env, capture=True)
            if tenant_count != '1' or int(draft_count) < 1:
                raise RuntimeError('Banco restaurado não contém o tenant e a sessão sintéticos.')
            media_rows = run('psql', '-X', '-qAt', '-c',
                             'SELECT row_to_json(r) FROM (SELECT "tenantId", "sessionId", '
                             '"manifestJson", "manifestSha256", "replaySha256", "replayBytes" '
                             'FROM "SessionRecording") r', env=restored_env, capture=True)
            recordings = [json.loads(line) for line in media_rows.splitlines() if line]
            if args.require_media and not recordings:
                raise RuntimeError('Banco restaurado não contém gravação referenciada.')
            segments_checked = 0
            for row in recordings:
                manifest_json = row['manifestJson']
                if hashlib.sha256(manifest_json.encode()).hexdigest() != row['manifestSha256']:
                    raise RuntimeError('Hash do manifesto gravado no banco divergiu.')
                manifest = json.loads(manifest_json)
                if manifest.get('sessionId') != row['sessionId']:
                    raise RuntimeError('Manifesto aponta para outra sessão.')
                for segment in manifest['segments']:
                    path = restored / 'recordings' / f"session-{row['sessionId']}" / segment['name']
                    if not path.is_file() or path.stat().st_size != segment['bytes'] or \
                            file_sha256(path) != segment['sha256']:
                        raise RuntimeError(f'Segmento restaurado divergente: {segment["name"]}')
                    segments_checked += 1
                replay = restored / 'replay' / row['tenantId'] / row['sessionId'] / 'replay.mp4'
                if not replay.is_file() or replay.stat().st_size != int(row['replayBytes']) or \
                        file_sha256(replay) != row['replaySha256']:
                    raise RuntimeError('Replay restaurado divergiu do banco.')
            result = {'ok': True, 'scope': 'synthetic-staging', 'bundleFiles': proof['files'],
                      'manifestSha256': proof['manifestSha256'], 'snapshotSeconds': snapshot_seconds,
                      'restoreAndVerifySeconds': round(time.monotonic() - started - snapshot_seconds, 3),
                      'restoredTenantCount': int(tenant_count), 'restoredDraftCount': int(draft_count),
                      'restoredVolumeMarkers': 3, 'activeDatabaseReplaced': False,
                      'restoredRecordingsVerified': len(recordings),
                      'restoredSegmentsVerified': segments_checked,
                      'officialRtoRpoMeasured': False}
    finally:
        try:
            if database_created:
                run('dropdb', restored_db, env=env)
        finally:
            try:
                if stopped:
                    compose('up', '-d', '--no-build', *SERVICES)
            finally:
                for path in marker_paths:
                    subprocess.run(['docker', 'exec', app, 'rm', '-f', path],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))


if __name__ == '__main__':
    main()
