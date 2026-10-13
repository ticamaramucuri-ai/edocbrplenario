#!/usr/bin/env python3
"""Run synthetic RTMPS forwarding and plenary traffic concurrently."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

from staging_health import ROOT, probe, values, verify_synthetic_scope

verify_synthetic_scope()
pg_env = {**os.environ, 'PGHOST': '127.0.0.1',
          'PGPORT': values.get('STAGE_DB_PORT', '55432'), 'PGUSER': 'edocbr_stage',
          'PGDATABASE': 'edocbr_stage', 'PGPASSWORD': values['STAGE_DB_PASSWORD']}
slugs = subprocess.run(['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c',
                        'SELECT slug FROM "Tenant" ORDER BY slug'], cwd=ROOT,
                       env=pg_env, capture_output=True, text=True, check=True).stdout.strip().splitlines()
if slugs != ['staging-example']:
    raise RuntimeError('Prova conjunta permitida somente na base sintética exclusiva.')
if probe():
    raise RuntimeError('A stack precisa estar saudável antes da prova conjunta.')
media_binary = Path(os.environ.get('MEDIAMTX_BIN', '/tmp/edocbr-mediamtx-v1.21.2/mediamtx'))
if not media_binary.is_file() or not os.access(media_binary, os.X_OK):
    raise RuntimeError('MediaMTX de laboratório ausente; execute bash scripts/prepare-media-smoke.sh.')

env = {**os.environ, 'MEDIAMTX_BIN': str(media_binary), 'KEEP_MEDIA_SMOKE': '1'}
media = None
mixed = None
media_output = ''
mixed_output = ''
started = time.monotonic()
try:
    media = subprocess.Popen(['bash', 'scripts/media-smoke.sh'], cwd=ROOT, env=env,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    mixed = subprocess.Popen([sys.executable, str(ROOT / 'scripts/staging-mixed-load.py'),
                              '--seconds', '40', '--runs', '3', '--readers', '4'],
                             cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    media_output, media_error = media.communicate(timeout=120)
    if media.returncode:
        raise RuntimeError(f'Transmissão local falhou: {media_error[-1000:]} {media_output[-500:]}')
    mixed_output, mixed_error = mixed.communicate(timeout=120)
    if mixed.returncode:
        raise RuntimeError(f'Carga do plenário falhou: {mixed_error[-1000:]} {mixed_output[-500:]}')
    traffic = json.loads(mixed_output)
    marker = 'Artefatos preservados: '
    paths = [line.split(marker, 1)[1] for line in media_output.splitlines() if marker in line]
    if len(paths) != 1:
        raise RuntimeError('Prova de mídia não informou diretório de evidência.')
    artifact_dir = Path(paths[0]).resolve()
    if artifact_dir.parent != Path('/tmp') or not artifact_dir.name.startswith('legis-media-smoke.'):
        raise RuntimeError('Diretório de evidência de mídia inesperado.')
    media_result = json.loads((artifact_dir / 'evidence.json').read_text())
    if (not traffic['ok'] or traffic['readErrors'] or traffic['healthFailures'] or
        traffic['votes'] != traffic['receipts'] or
        traffic['votes'] != traffic['voteOutboxEvents'] or
        media_result['configuredDestinations'] != 2 or
        min(media_result['originSegments'], media_result['receiverSegments'],
            media_result['secondReceiverSegments']) < 2 or
        not media_result['secondReceiverSurvivedFirstFailure']):
        raise RuntimeError('Prova conjunta registrou divergência de votação, leitura ou mídia.')
    print(json.dumps({'ok': True, 'synthetic': True, 'official': False,
                      'sameHost': True, 'durationSeconds': round(time.monotonic() - started, 2),
                      'votes': traffic['votes'], 'receipts': traffic['receipts'],
                      'readRequests': traffic['readRequests'], 'readErrors': traffic['readErrors'],
                      'replaySha256': traffic['replaySha256'],
                      'media': media_result}, sort_keys=True))
finally:
    for process in (media, mixed):
        if process is not None and process.poll() is None:
            process.terminate()
            try:
                process.communicate(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.communicate()
    if media_output:
        marker = 'Artefatos preservados: '
        for line in media_output.splitlines():
            if marker in line:
                candidate = Path(line.split(marker, 1)[1]).resolve()
                if candidate.parent == Path('/tmp') and candidate.name.startswith('legis-media-smoke.'):
                    shutil.rmtree(candidate)
