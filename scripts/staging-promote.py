#!/usr/bin/env python3
"""Promove um commit Git já obtido na VPS para a stack sintética de homologação."""

import argparse
import json
import os
from pathlib import Path
import re
import stat
import subprocess
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / 'deploy/staging/.env'


def command(*args: str) -> str:
    return subprocess.run(args, cwd=ROOT, check=True, capture_output=True, text=True).stdout.strip()


def set_version(commit: str) -> str:
    if CONFIG.is_symlink() or not CONFIG.is_file() or stat.S_IMODE(CONFIG.stat().st_mode) & 0o077:
        raise RuntimeError('deploy/staging/.env privado (modo 600) é obrigatório.')
    lines = CONFIG.read_text().splitlines()
    previous = next((line.partition('=')[2] for line in lines if line.startswith('STAGE_BUILD_VERSION=')), '')
    lines = [line for line in lines if not line.startswith('STAGE_BUILD_VERSION=')]
    lines.append(f'STAGE_BUILD_VERSION={commit}')
    temporary = CONFIG.with_name('.env.promote.tmp')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, 'w') as stream:
            stream.write('\n'.join(lines) + '\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, CONFIG)
    finally:
        temporary.unlink(missing_ok=True)
    return previous


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--commit', required=True)
    args = parser.parse_args()
    commit = args.commit
    if not re.fullmatch(r'[0-9a-f]{40}', commit):
        parser.error('--commit deve ser um SHA completo.')
    if command('git', 'rev-parse', 'HEAD') != commit:
        raise RuntimeError('O checkout da VPS não corresponde ao commit solicitado.')
    if command('git', 'status', '--porcelain', '--untracked-files=no'):
        raise RuntimeError('Há modificações rastreadas na VPS; implantação recusada.')
    if command('git', 'rev-parse', 'refs/remotes/origin/main') != commit:
        raise RuntimeError('O commit não é o main obtido do GitHub.')
    previous = set_version(commit)
    subprocess.run(['python3', 'scripts/staging-postgres.py', 'stack-up'], cwd=ROOT, check=True)
    proof = json.loads(command('python3', 'scripts/staging-image-proof.py'))
    if not proof.get('ok') or proof.get('expectedVersion') != commit:
        raise RuntimeError('Imagem ou contêineres divergem do commit promovido.')
    with urlopen('http://127.0.0.1:3181/api/v1/health?ready=1', timeout=15) as response:
        if response.status != 200:
            raise RuntimeError(f'Prontidão HTTP inesperada: {response.status}')
    print(json.dumps({'promoted': True, 'version': commit, 'previousVersion': previous,
                      'health': 'ready', 'syntheticOnly': True}, sort_keys=True))


if __name__ == '__main__':
    main()
