#!/usr/bin/env python3
"""Constrói a imagem de homologação a partir do commit que ela anuncia."""

import argparse
import json
from pathlib import Path
import re
import stat
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / 'deploy/staging/.env'
IMAGE = 'edocbr-plenario-staging:local'


def configured_version() -> str:
    if CONFIG.is_symlink() or not CONFIG.is_file():
        raise RuntimeError('Crie deploy/staging/.env como arquivo privado antes do build.')
    if stat.S_IMODE(CONFIG.stat().st_mode) & 0o077:
        raise RuntimeError('deploy/staging/.env deve ter permissão 600.')
    values = {}
    for line in CONFIG.read_text().splitlines():
        if '=' in line and not line.startswith('#'):
            key, value = line.split('=', 1)
            values[key] = value
    return values.get('STAGE_BUILD_VERSION', 'local-unversioned')


def source_commit(version: str) -> str | None:
    if version == 'local-unversioned':
        return None
    if not re.fullmatch(r'[0-9a-f]{40}', version):
        raise RuntimeError('STAGE_BUILD_VERSION deve ser um SHA Git completo ou local-unversioned.')
    head = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=ROOT, check=True,
                          capture_output=True, text=True).stdout.strip()
    if version != head:
        raise RuntimeError('STAGE_BUILD_VERSION difere de HEAD; ajuste a versão antes do build.')
    return head


def build(version: str, commit: str | None) -> None:
    if commit is None:
        subprocess.run(['docker', 'build', '--file', str(ROOT / 'deploy/staging/Dockerfile'),
                        '--tag', IMAGE, '--build-arg', 'NEXT_PUBLIC_REALTIME_URL=',
                        '--build-arg', 'STAGE_BUILD_VERSION=local-unversioned', str(ROOT)],
                       cwd=ROOT, check=True)
        return

    with tempfile.TemporaryDirectory(prefix='edocbr-stage-source-') as temporary:
        source = Path(temporary) / 'source'
        source.mkdir()
        archive = Path(temporary) / 'source.tar'
        with archive.open('wb') as output:
            subprocess.run(['git', 'archive', '--format=tar', commit], cwd=ROOT,
                           stdout=output, check=True)
        subprocess.run(['tar', '-xf', str(archive), '-C', str(source)], check=True)
        subprocess.run(['docker', 'build', '--file', str(source / 'deploy/staging/Dockerfile'),
                        '--tag', IMAGE, '--build-arg', 'NEXT_PUBLIC_REALTIME_URL=',
                        '--build-arg', f'STAGE_BUILD_VERSION={version}', str(source)],
                       cwd=ROOT, check=True)
    label = subprocess.run(['docker', 'image', 'inspect', IMAGE, '--format',
                            '{{index .Config.Labels "org.opencontainers.image.revision"}}'],
                           capture_output=True, text=True, check=True).stdout.strip()
    if label != commit:
        raise RuntimeError('Rótulo da imagem diverge do commit exportado.')


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true',
                        help='validar configuração e commit sem construir imagem')
    args = parser.parse_args()
    version = configured_version()
    commit = source_commit(version)
    if not args.check:
        build(version, commit)
    print(json.dumps({'image': IMAGE, 'mode': 'commit-archive' if commit else 'working-tree',
                      'version': version, 'built': not args.check}, sort_keys=True))


if __name__ == '__main__':
    main()
