#!/usr/bin/env python3
"""Ensaio descartável de backup/restauração SQLite + quatro raízes de arquivos."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sqlite3
import subprocess
import tempfile
from time import perf_counter

BUNDLE = Path(__file__).with_name('backup-bundle.py')
ASSET_NAMES = ('images', 'public', 'recordings', 'replay')


def run(*args: str) -> dict:
    result = subprocess.run(['python3', str(BUNDLE), *args], capture_output=True, text=True, check=True)
    return json.loads(result.stdout)


def sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def drill() -> dict:
    with tempfile.TemporaryDirectory(prefix='edocbr-recovery-drill-') as directory:
        root = Path(directory)
        source = root / 'source.sqlite'
        expected = {}
        for name in ASSET_NAMES:
            asset_dir = root / name
            asset_dir.mkdir()
            content = (name.encode('ascii') + b'\n') * (128 * 1024)
            (asset_dir / 'prova.bin').write_bytes(content)
            expected[name] = sha256(content)
        with sqlite3.connect(source) as db:
            db.execute('CREATE TABLE recovery_proof (asset TEXT PRIMARY KEY, digest TEXT NOT NULL)')
            db.executemany('INSERT INTO recovery_proof (asset, digest) VALUES (?, ?)', expected.items())
            db.commit()

        bundle = root / 'bundle'
        restored = root / 'restored'
        started = perf_counter()
        created = run('create', '--database', 'sqlite', '--sqlite-source', str(source),
                      '--output', str(bundle), *(part for name in ASSET_NAMES
                      for part in (f'--{name}-root', str(root / name))))
        backed_up = perf_counter()
        verified = run('verify', '--bundle', str(bundle))
        integrity_checked = perf_counter()
        copied = run('restore-files', '--bundle', str(bundle), '--target', str(restored))
        with sqlite3.connect(restored / 'database.sqlite') as db:
            rows = dict(db.execute('SELECT asset, digest FROM recovery_proof'))
            if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise RuntimeError('Banco restaurado falhou no integrity_check')
        if rows != expected:
            raise RuntimeError('Registros restaurados divergem da origem')
        for name in ASSET_NAMES:
            if sha256((restored / name / 'prova.bin').read_bytes()) != rows[name]:
                raise RuntimeError(f'Arquivo restaurado divergiu: {name}')
        if len({created['manifestSha256'], verified['manifestSha256'], copied['manifestSha256']}) != 1:
            raise RuntimeError('Manifesto divergiu durante recuperação')
        completed = perf_counter()
        return {
            'scope': 'disposable-sqlite-fixture',
            'checkedAt': datetime.now(timezone.utc).isoformat(),
            'databaseRowsVerified': len(rows),
            'assetRootsVerified': len(ASSET_NAMES),
            'assetBytes': sum((root / name / 'prova.bin').stat().st_size for name in ASSET_NAMES),
            'manifestSha256': copied['manifestSha256'],
            'backupSeconds': round(backed_up - started, 3),
            'verifySeconds': round(integrity_checked - backed_up, 3),
            'restoreAndReadSeconds': round(completed - integrity_checked, 3),
            'totalSeconds': round(completed - started, 3),
            'integrity': 'verified',
            'rtoObserved': False,
            'rpoObserved': False,
            'note': 'Tempos de fixture descartável; não incluem incidente, corte, restart da aplicação ou escrita concorrente.',
        }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, help='JSON de evidência; destino novo ou arquivo substituível do ensaio')
    args = parser.parse_args()
    result = drill()
    serialized = json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(serialized + '\n')
    print(serialized)


if __name__ == '__main__':
    main()
