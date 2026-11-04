#!/usr/bin/env python3
import json
from pathlib import Path
import sqlite3
import subprocess
import tempfile

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/backup-bundle.py'


def run(*args: str, success=True):
    result = subprocess.run(['python3', str(SCRIPT), *args], capture_output=True, text=True)
    if success and result.returncode:
        raise AssertionError(result.stderr)
    if not success and result.returncode == 0:
        raise AssertionError('Comando deveria falhar')
    return result


with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    source = root / 'source.sqlite'
    with sqlite3.connect(source) as db:
        db.execute('CREATE TABLE proof (value TEXT)')
        db.execute("INSERT INTO proof VALUES ('restaurado')")
    images, public = root / 'images', root / 'public'
    images.mkdir(); public.mkdir()
    (images / 'foto.webp').write_bytes(b'foto')
    (public / 'anexo.txt').write_bytes(b'anexo')
    bundle = root / 'bundle'
    run('create', '--database', 'sqlite', '--sqlite-source', str(source), '--output', str(bundle),
        '--images-root', str(images), '--public-root', str(public))
    proof = json.loads(run('verify', '--bundle', str(bundle)).stdout)
    assert proof['files'] == 3
    original_manifest = (bundle / 'manifest.json').read_bytes()
    altered_manifest = json.loads(original_manifest)
    altered_manifest['files'][0]['sha256'] = '0' * 64
    (bundle / 'manifest.json').write_text(json.dumps(altered_manifest))
    failure = run('verify', '--bundle', str(bundle), success=False)
    assert 'hash divergente' in failure.stderr, failure.stderr
    (bundle / 'manifest.json').write_bytes(original_manifest)
    restored = root / 'restored'
    assert json.loads(run('restore-files', '--bundle', str(bundle), '--target', str(restored)).stdout)['manifestSha256'] == proof['manifestSha256']
    with sqlite3.connect(restored / 'database.sqlite') as db:
        assert db.execute('SELECT value FROM proof').fetchone()[0] == 'restaurado'
    (restored / 'images/foto.webp').write_bytes(b'adulterada')
    run('verify', '--bundle', str(restored), success=False)
    (restored / 'images/foto.webp').write_bytes(b'foto')
    (restored / 'extra.txt').write_text('extra')
    run('verify', '--bundle', str(restored), success=False)
    (restored / 'extra.txt').unlink()
    (restored / 'images/foto.webp').unlink()
    (restored / 'images/foto.webp').symlink_to(source)
    run('verify', '--bundle', str(restored), success=False)
print('Pacote SQLite: restauração, manifesto adulterado, hash, arquivo extra e symlink verificados.')
