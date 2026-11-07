#!/usr/bin/env python3
"""Receive, verify and retain encrypted snapshots of synthetic staging.

Run on a separate host. The recipient's private key never leaves that host.
This is a staging tool, not a configured production backup service.
"""

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shlex
import stat
import subprocess
import sys
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parent.parent


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def require_file(path: Path, *, private: bool = False) -> None:
    if not path.is_absolute() or path.is_symlink() or not path.is_file():
        raise ValueError(f'Arquivo absoluto regular exigido: {path}')
    if private and stat.S_IMODE(path.stat().st_mode) & 0o077:
        raise ValueError('Chave privada deve ter modo 0600 ou mais restrito.')


def extract_bundle(archive: Path, destination: Path) -> Path:
    with tarfile.open(archive, 'r:') as tar:
        members = tar.getmembers()
        if not members or not all(member.name == 'bundle' or member.name.startswith('bundle/')
                                  for member in members):
            raise ValueError('Arquivo recebido não contém apenas o pacote esperado.')
        for member in members:
            parts = Path(member.name).parts
            if '..' in parts or not (member.isfile() or member.isdir()):
                raise ValueError('Arquivo recebido contém entrada insegura.')
        tar.extractall(destination, filter='data')
    return destination / 'bundle'


def source_command(args) -> list[str]:
    if args.local_source:
        return [sys.executable, str(ROOT / 'scripts/staging-snapshot-stream.py'),
                '--cert', str(args.remote_cert)]
    if not args.target or not args.identity or not args.remote_repo:
        raise ValueError('Informe --target, --identity e --remote-repo para SSH.')
    require_file(args.identity, private=True)
    if not args.remote_repo.is_absolute() or not args.remote_cert.is_absolute():
        raise ValueError('Caminhos remotos devem ser absolutos.')
    remote = 'cd ' + shlex.quote(str(args.remote_repo)) + ' && python3 scripts/staging-snapshot-stream.py --cert ' + shlex.quote(str(args.remote_cert))
    return ['ssh', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
            '-o', 'IdentitiesOnly=yes', '-i', str(args.identity), args.target, remote]


def receive(args) -> dict:
    require_file(args.cert)
    require_file(args.key, private=True)
    if not args.vault.is_absolute() or args.vault.is_symlink():
        raise ValueError('Vault deve ser caminho absoluto sem symlink.')
    args.vault.mkdir(mode=0o700, parents=True, exist_ok=True)
    if stat.S_IMODE(args.vault.stat().st_mode) & 0o077:
        raise ValueError('Vault deve ter modo 0700 ou mais restrito.')
    command = source_command(args)
    now = datetime.now(timezone.utc)
    name = 'staging-' + now.strftime('%Y%m%dT%H%M%SZ') + '-' + os.urandom(4).hex()
    with tempfile.TemporaryDirectory(prefix='.incoming-', dir=args.vault) as work_name:
        work = Path(work_name)
        encrypted = work / 'snapshot.cms'
        with encrypted.open('wb') as output:
            source = subprocess.run(command, stdout=output, stderr=subprocess.PIPE, text=True)
        if source.returncode or encrypted.stat().st_size == 0:
            raise RuntimeError('Fonte falhou ou enviou arquivo vazio: ' + source.stderr[-2000:])
        archive = work / 'snapshot.tar'
        with archive.open('wb') as output:
            decrypted = subprocess.run(['openssl', 'cms', '-decrypt', '-binary', '-inform', 'DER',
                                        '-recip', str(args.cert), '-inkey', str(args.key),
                                        '-in', str(encrypted)], stdout=output, stderr=subprocess.PIPE, text=True)
        if decrypted.returncode:
            raise RuntimeError('Não foi possível decifrar o snapshot: ' + decrypted.stderr[-1000:])
        bundle = extract_bundle(archive, work / 'extracted')
        verified = subprocess.run([sys.executable, str(ROOT / 'scripts/backup-bundle.py'),
                                   'verify', '--bundle', str(bundle)], capture_output=True, text=True, check=True)
        proof = json.loads(verified.stdout)
        metadata = {'scope': 'synthetic-staging', 'receivedAt': now.isoformat(),
                    'ciphertextBytes': encrypted.stat().st_size,
                    'ciphertextSha256': sha256(encrypted), **proof}
        final = args.vault / (name + '.cms')
        encrypted.rename(final)
        sidecar = args.vault / (name + '.json')
        sidecar.write_text(json.dumps(metadata, indent=2, sort_keys=True) + '\n')
        sidecar.chmod(0o600)
    snapshots = sorted(args.vault.glob('staging-*.cms'), key=lambda path: path.name, reverse=True)
    for old in snapshots[args.keep:]:
        if old.is_symlink() or not old.is_file():
            raise ValueError('Retenção encontrou entrada insegura.')
        companion = old.with_suffix('.json')
        old.unlink()
        if companion.is_file() and not companion.is_symlink():
            companion.unlink()
    return {'snapshot': str(final), 'metadata': str(sidecar), **metadata}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--vault', type=Path, required=True)
    parser.add_argument('--cert', type=Path, required=True, help='Certificado público local')
    parser.add_argument('--key', type=Path, required=True, help='Chave privada local, modo 0600')
    parser.add_argument('--remote-cert', type=Path, required=True, help='Caminho do certificado na fonte')
    parser.add_argument('--target', help='Usuário e host SSH da fonte')
    parser.add_argument('--identity', type=Path, help='Chave SSH local, modo 0600')
    parser.add_argument('--remote-repo', type=Path, help='Repositório na fonte')
    parser.add_argument('--local-source', action='store_true', help='Ensaio com staging deste computador')
    parser.add_argument('--keep', type=int, default=7)
    args = parser.parse_args()
    if args.keep < 1:
        parser.error('--keep deve ser positivo')
    print(json.dumps(receive(args), sort_keys=True))


if __name__ == '__main__':
    main()
