#!/usr/bin/env python3
"""Inventory image bytes and references; optional conservative orphan cleanup."""
import argparse
from collections import Counter
from contextlib import closing
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import time

NAME = re.compile(r'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.webp$')
TENANT = re.compile(r'^[a-z0-9]{15,35}$')
PREFIX = '/api/v1/public/parliamentarian-images/'

parser = argparse.ArgumentParser()
parser.add_argument('--source', type=Path, required=True)
parser.add_argument('--root', type=Path, required=True)
parser.add_argument('--strict', action='store_true')
parser.add_argument('--delete-orphans', action='store_true', help='Remove somente órfãos com pelo menos 24 horas')
args = parser.parse_args()
root = args.root
if not root.is_absolute() or root.is_symlink() or not root.is_dir():
    raise SystemExit('Raiz de imagens deve ser diretório absoluto existente, sem symlink.')

references = set()
counts = Counter()
with closing(sqlite3.connect(args.source.resolve().as_uri() + '?mode=ro', uri=True)) as db:
    for table, columns in [('Parliamentarian', ('photoUrl', 'partyEmblemUrl')), ('Party', ('emblemUrl',))]:
        for tenant, *values in db.execute(f'SELECT tenantId, {", ".join(columns)} FROM {table}'):
            for url in values:
                if url is None:
                    continue
                parts = url[len(PREFIX):].split('/') if url.startswith(PREFIX) else []
                if len(parts) != 2 or parts[0] != tenant or not TENANT.fullmatch(parts[0]) or not NAME.fullmatch(parts[1]):
                    counts['invalid_reference'] += 1
                else:
                    references.add((parts[0], parts[1]))

fingerprint = hashlib.sha256()
seen = set()
threshold = time.time() - 24 * 3600
for directory in root.iterdir():
    if directory.is_symlink() or not directory.is_dir() or not TENANT.fullmatch(directory.name):
        counts['unsafe_entry'] += 1
        continue
    for file in directory.iterdir():
        if file.is_symlink() or not file.is_file() or not NAME.fullmatch(file.name):
            counts['unsafe_entry'] += 1
            continue
        key = (directory.name, file.name)
        if key in references:
            seen.add(key)
            digest = hashlib.sha256(file.read_bytes()).hexdigest()
            fingerprint.update(json.dumps([*key, file.stat().st_size, digest]).encode() + b'\n')
            counts['referenced_file'] += 1
        elif file.stat().st_mtime < threshold:
            counts['old_orphan'] += 1
            if args.delete_orphans:
                file.unlink()
                counts['deleted_orphan'] += 1
        else:
            counts['recent_orphan'] += 1
counts['missing_reference'] = len(references - seen)
print(json.dumps({'counts': dict(sorted(counts.items())), 'referencedFilesSha256': fingerprint.hexdigest()}, sort_keys=True))
if args.strict and (counts['invalid_reference'] or counts['unsafe_entry'] or counts['missing_reference']):
    raise SystemExit(1)
