#!/usr/bin/env python3
"""Private, verifiable database+asset bundle. Run after pausing all writers."""
import argparse
from contextlib import closing
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import tempfile
from urllib.parse import parse_qs, unquote, urlsplit

ASSETS = ('images', 'public', 'recordings', 'replay')


def check_tree(root: Path) -> None:
    if not root.is_absolute() or not root.is_dir() or root.is_symlink():
        raise ValueError(f'Raiz inválida: {root}')
    for path in root.rglob('*'):
        if path.is_symlink():
            raise ValueError(f'Symlink proibido no pacote: {path}')


def digest(path: Path) -> str:
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()


def pg_env() -> dict[str, str]:
    parsed = urlsplit(os.environ.get('POSTGRES_BACKUP_URL', ''))
    if parsed.scheme not in ('postgres', 'postgresql') or not parsed.hostname or not parsed.path.strip('/'):
        raise ValueError('POSTGRES_BACKUP_URL deve apontar para PostgreSQL')
    env = os.environ.copy()
    env.update(PGHOST=parsed.hostname, PGPORT=str(parsed.port or 5432),
               PGDATABASE=unquote(parsed.path.lstrip('/')), PGUSER=unquote(parsed.username or ''),
               PGPASSWORD=unquote(parsed.password or ''))
    options = parse_qs(parsed.query)
    if 'sslmode' in options:
        env['PGSSLMODE'] = options['sslmode'][0]
    env.pop('POSTGRES_BACKUP_URL', None)
    return env


def files(root: Path):
    for path in sorted(root.rglob('*')):
        if path.is_symlink():
            raise ValueError('Pacote contém symlink')
        if path.is_file():
            yield path


def manifest_for(root: Path, database: str) -> dict:
    return {'version': 1, 'database': database, 'createdAt': datetime.now(timezone.utc).isoformat(),
            'files': [{'path': path.relative_to(root).as_posix(), 'bytes': path.stat().st_size, 'sha256': digest(path)}
                      for path in files(root) if path != root / 'manifest.json']}


def verify(bundle: Path) -> dict:
    if not bundle.is_absolute() or not bundle.is_dir() or bundle.is_symlink():
        raise ValueError('Pacote deve ser diretório absoluto sem symlink')
    manifest = json.loads((bundle / 'manifest.json').read_text())
    if manifest.get('version') != 1 or manifest.get('database') not in ('sqlite', 'postgresql'):
        raise ValueError('Formato de pacote desconhecido')
    expected = manifest.get('files')
    if not isinstance(expected, list):
        raise ValueError('Manifesto inválido')
    listed = set()
    for entry in expected:
        relative = entry['path']
        parts = Path(relative).parts
        if not parts or relative.startswith('/') or any(part in ('.', '..') for part in parts) or relative in listed:
            raise ValueError('Caminho inválido ou repetido no manifesto')
        listed.add(relative)
        path = bundle / relative
        if any((bundle.joinpath(*parts[:index])).is_symlink() for index in range(1, len(parts) + 1)):
            raise ValueError('Symlink proibido no pacote')
        if path.is_symlink() or not path.is_file() or path.stat().st_size != entry['bytes'] or digest(path) != entry['sha256']:
            raise ValueError('Arquivo ausente ou hash divergente no pacote')
    actual = {path.relative_to(bundle).as_posix() for path in files(bundle) if path != bundle / 'manifest.json'}
    if actual != listed:
        raise ValueError('Arquivos extras ou ausentes no pacote')
    if manifest['database'] == 'sqlite':
        dbpath = bundle / 'database.sqlite'
        with closing(sqlite3.connect(dbpath.resolve().as_uri() + '?mode=ro&immutable=1', uri=True)) as db:
            if db.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
                raise ValueError('SQLite quick_check falhou')
    else:
        result = subprocess.run(['pg_restore', '--list', str(bundle / 'database.dump')], capture_output=True, text=True)
        if result.returncode:
            raise ValueError('pg_restore não consegue ler o dump')
    return {'database': manifest['database'], 'files': len(listed),
            'manifestSha256': digest(bundle / 'manifest.json')}


def create(args) -> dict:
    output = args.output.resolve()
    if output.exists():
        raise ValueError('Destino já existe; escolha um diretório novo')
    roots = {name: getattr(args, f'{name}_root') for name in ASSETS}
    if bool(roots['recordings']) != bool(roots['replay']):
        raise ValueError('Informe recordings-root e replay-root juntos')
    if not roots['images'] or not roots['public']:
        raise ValueError('Imagens e public são obrigatórios')
    for root in roots.values():
        if root:
            check_tree(root)
    if args.database == 'sqlite' and (not args.sqlite_source or not args.sqlite_source.is_file()):
        raise ValueError('Informe --sqlite-source existente')
    if args.database == 'postgresql' and args.sqlite_source:
        raise ValueError('SQLite não deve ser informado para backup PostgreSQL')
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.edocbr-bundle-', dir=output.parent) as temporary:
        staging = Path(temporary)
        staging.chmod(0o700)
        if args.database == 'sqlite':
            with closing(sqlite3.connect(args.sqlite_source)) as source, closing(sqlite3.connect(staging / 'database.sqlite')) as target:
                source.backup(target)
        else:
            subprocess.run([os.environ.get('POSTGRES_DUMP_BIN', 'pg_dump'), '-Fc', '-f', str(staging / 'database.dump')], env=pg_env(), check=True)
        for name, root in roots.items():
            if root:
                shutil.copytree(root, staging / name, copy_function=shutil.copy2)
        manifest = manifest_for(staging, args.database)
        (staging / 'manifest.json').write_text(json.dumps(manifest, sort_keys=True, separators=(',', ':')))
        (staging / 'manifest.json').chmod(0o600)
        proof = verify(staging)
        staging.rename(output)
        return proof


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    make = sub.add_parser('create')
    make.add_argument('--database', choices=['sqlite', 'postgresql'], required=True)
    make.add_argument('--sqlite-source', type=Path)
    make.add_argument('--output', type=Path, required=True)
    for name in ASSETS:
        make.add_argument(f'--{name}-root', type=Path)
    check = sub.add_parser('verify')
    check.add_argument('--bundle', type=Path, required=True)
    restore = sub.add_parser('restore-files')
    restore.add_argument('--bundle', type=Path, required=True)
    restore.add_argument('--target', type=Path, required=True)
    args = parser.parse_args()
    if args.command == 'create':
        result = create(args)
    elif args.command == 'verify':
        result = verify(args.bundle)
    else:
        result = verify(args.bundle)
        if args.target.exists():
            raise ValueError('Destino de restauração já existe')
        shutil.copytree(args.bundle, args.target, symlinks=False)
        restored = verify(args.target)
        if restored['manifestSha256'] != result['manifestSha256']:
            raise ValueError('Manifesto restaurado divergiu')
        result = restored
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    main()
