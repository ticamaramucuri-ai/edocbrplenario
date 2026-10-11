#!/usr/bin/env python3
"""Read-only inventory of attachment references and recording bytes; no file names in output."""
import argparse
from collections import Counter
from contextlib import closing
import hashlib
import json
from pathlib import Path
import re
import sqlite3
from urllib.parse import unquote, urlsplit


SAFE_ID = re.compile(r'^[a-zA-Z0-9_-]{1,128}$')
SAFE_SEGMENT = re.compile(r'^\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d-\d{6}\.mp4$')


def digest_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def safe_file(root: Path, relative: str) -> Path | None:
    if not root.is_dir() or root.is_symlink():
        return None
    components = Path(relative).parts
    path = root / relative
    if any(part in ('.', '..') for part in components):
        return None
    current = root
    for part in components:
        current = current / part
        if current.is_symlink():
            return None
    resolved = path.resolve()
    if not resolved.is_relative_to(root.resolve()) or not path.is_file():
        return None
    return path


def audit_attachment(url: str | None, size: int, public: Path) -> tuple[str, str]:
    if not url:
        return 'metadata_only', ''
    parsed = urlsplit(url)
    if parsed.scheme in ('http', 'https') and parsed.netloc:
        return 'remote_unverified', ''
    if not url.startswith('/') or url.startswith('//') or parsed.query or parsed.fragment:
        return 'unsupported_reference', ''
    relative = unquote(parsed.path).lstrip('/')
    path = safe_file(public, relative)
    if path is None:
        return 'missing_local', ''
    if size and path.stat().st_size != size:
        return 'size_mismatch', ''
    return 'verified_local', digest_file(path)


def audit_recording(row: sqlite3.Row, source_root: Path | None, replay_root: Path | None) -> tuple[str, str]:
    session_id, tenant_id = row['sessionId'], row['tenantId']
    if not SAFE_ID.fullmatch(session_id) or not SAFE_ID.fullmatch(tenant_id):
        return 'unsafe_identifier', ''
    manifest_json = row['manifestJson']
    if hashlib.sha256(manifest_json.encode()).hexdigest() != row['manifestSha256']:
        return 'manifest_mismatch', ''
    try:
        manifest = json.loads(manifest_json)
        segments = manifest['segments']
        if manifest['sessionId'] != session_id or not isinstance(segments, list) or not segments:
            return 'manifest_invalid', ''
    except (ValueError, KeyError, TypeError):
        return 'manifest_invalid', ''
    if source_root is None or replay_root is None:
        return 'roots_unconfigured', ''
    source_dir = source_root / f'session-{session_id}'
    if not source_dir.is_dir() or source_dir.is_symlink() or not source_dir.resolve().is_relative_to(source_root.resolve()):
        return 'source_missing', ''
    for segment in segments:
        name = segment.get('name') if isinstance(segment, dict) else None
        if not isinstance(name, str) or not SAFE_SEGMENT.fullmatch(name):
            return 'manifest_invalid', ''
        path = safe_file(source_dir, name)
        if path is None:
            return 'segment_missing', ''
        if path.stat().st_size != segment.get('bytes') or digest_file(path) != segment.get('sha256'):
            return 'segment_mismatch', ''
    replay = safe_file(replay_root, f'{tenant_id}/{session_id}/replay.mp4')
    if replay is None:
        return 'replay_missing', ''
    if replay.stat().st_size != row['replayBytes'] or digest_file(replay) != row['replaySha256']:
        return 'replay_mismatch', ''
    return 'verified_recording', row['manifestSha256']


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--public-root', type=Path, default=Path('public'))
    parser.add_argument('--recordings-root', type=Path)
    parser.add_argument('--replay-root', type=Path)
    parser.add_argument('--strict', action='store_true', help='falha para arquivo pendente ou referência não verificável')
    args = parser.parse_args()
    inventory = hashlib.sha256()
    counts: Counter[str] = Counter()
    with closing(sqlite3.connect(args.source.resolve().as_uri() + '?mode=ro', uri=True)) as db:
        db.row_factory = sqlite3.Row
        for row in db.execute('SELECT id, url, sizeBytes FROM MatterAttachment ORDER BY id'):
            status, digest = audit_attachment(row['url'], row['sizeBytes'], args.public_root)
            counts['attachment_' + status] += 1
            inventory.update(json.dumps(['attachment', row['id'], row['url'], row['sizeBytes'], status, digest],
                                        ensure_ascii=False, separators=(',', ':')).encode() + b'\n')
        for row in db.execute('SELECT * FROM SessionRecording ORDER BY id'):
            status, digest = audit_recording(row, args.recordings_root, args.replay_root)
            counts['recording_' + status] += 1
            inventory.update(json.dumps(['recording', row['id'], row['manifestSha256'],
                                         row['replaySha256'], row['replayBytes'], status, digest],
                                        ensure_ascii=False, separators=(',', ':')).encode() + b'\n')
    print(json.dumps({'counts': dict(sorted(counts.items())), 'inventorySha256': inventory.hexdigest()}, sort_keys=True))
    allowed = {'attachment_metadata_only', 'attachment_verified_local', 'recording_verified_recording'}
    if args.strict and any(count for status, count in counts.items() if status not in allowed):
        raise SystemExit(1)


if __name__ == '__main__':
    main()
