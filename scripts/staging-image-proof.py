#!/usr/bin/env python3
"""Confere se a stack local usa a imagem do commit fixado para homologação."""

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / 'deploy/staging/.env'
COMPOSE = ROOT / 'deploy/staging/compose.yaml'
IMAGE = 'edocbr-plenario-staging:local'
REVISION_LABEL = 'org.opencontainers.image.revision'


def command(*args: str) -> str:
    result = subprocess.run(args, cwd=ROOT, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(f'{args[0]} {args[1]} falhou: {result.stderr.strip()[:300]}')
    return result.stdout.strip()


def inspect(target: str) -> dict:
    values = json.loads(command('docker', 'inspect', target))
    if len(values) != 1:
        raise RuntimeError(f'Inspeção ambígua: {target}')
    return values[0]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--include-mail', action='store_true', help='exigir também mail_worker')
    parser.add_argument('--expected-version', help='sobrescreve o SHA esperado para uma prova negativa')
    args = parser.parse_args()

    configured = json.loads(command('python3', str(ROOT / 'scripts/staging-build.py'), '--check'))
    expected = args.expected_version or configured['version']
    problems = []
    if configured['mode'] != 'commit-archive':
        problems.append('Build local-unversioned não identifica um commit.')
    if expected != configured['version']:
        problems.append('Revisão esperada diverge da configuração privada.')
    image = inspect(IMAGE)
    image_id = image['Id']
    image_revision = (image.get('Config', {}).get('Labels') or {}).get(REVISION_LABEL)
    if image_revision != expected:
        problems.append('Rótulo da imagem diverge da revisão esperada.')

    services = ['app', 'realtime', 'webhooks', 'scheduler']
    if args.include_mail:
        services.append('mail_worker')
    observed = []
    for name in services:
        container_id = command('docker', 'compose', '--profile', 'mail-lab',
                               '--env-file', str(CONFIG), '-f', str(COMPOSE), 'ps', '-q', name)
        if not container_id:
            problems.append(f'{name}: contêiner ausente.')
            observed.append({'service': name, 'present': False})
            continue
        container = inspect(container_id)
        state = container.get('State', {})
        health = state.get('Health', {}).get('Status')
        revision = (container.get('Config', {}).get('Labels') or {}).get(REVISION_LABEL)
        same_image = container.get('Image') == image_id
        running = state.get('Running') is True
        healthy = health == 'healthy'
        if not same_image or revision != expected or not running or not healthy:
            problems.append(f'{name}: imagem, revisão, execução ou saúde divergente.')
        observed.append({'service': name, 'present': True, 'sameImage': same_image,
                         'revision': revision, 'running': running, 'health': health})

    proof = {'checkedAt': datetime.now(timezone.utc).isoformat(), 'scope': 'local-staging',
             'expectedVersion': expected, 'configuredVersion': configured['version'],
             'image': IMAGE, 'imageId': image_id, 'imageRevision': image_revision,
             'services': observed, 'ok': not problems, 'problems': problems,
             'remoteObserver': False}
    print(json.dumps(proof, ensure_ascii=False, indent=2, sort_keys=True))
    return 0 if not problems else 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (RuntimeError, KeyError, json.JSONDecodeError) as error:
        print(f'Falha ao conferir imagem: {error}', file=sys.stderr)
        sys.exit(2)
