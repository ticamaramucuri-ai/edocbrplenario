import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


module_path = Path(__file__).resolve().parents[1] / 'scripts/audit-external-assets.py'
spec = importlib.util.spec_from_file_location('asset_audit', module_path)
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class AssetAuditTest(unittest.TestCase):
    def test_attachment_checks_file_hash_size_and_path(self):
        with tempfile.TemporaryDirectory() as directory:
            public = Path(directory)
            (public / 'example.pdf').write_bytes(b'fixture')
            status, digest = audit.audit_attachment('/example.pdf', 7, public)
            self.assertEqual(status, 'verified_local')
            self.assertEqual(digest, hashlib.sha256(b'fixture').hexdigest())
            self.assertEqual(audit.audit_attachment('/example.pdf', 8, public)[0], 'size_mismatch')
            self.assertEqual(audit.audit_attachment('/missing.pdf', 0, public)[0], 'missing_local')
            self.assertEqual(audit.audit_attachment('/%2e%2e/secret', 0, public)[0], 'missing_local')
            self.assertEqual(audit.audit_attachment('javascript:alert(1)', 0, public)[0], 'unsupported_reference')

    def test_recording_verifies_manifest_segments_and_replay(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'source'
            replay_root = root / 'replay'
            segment_dir = source / 'session-s1'
            replay_dir = replay_root / 't1' / 's1'
            segment_dir.mkdir(parents=True)
            replay_dir.mkdir(parents=True)
            name = '2026-10-11_10-00-00-000000.mp4'
            (segment_dir / name).write_bytes(b'segment')
            (replay_dir / 'replay.mp4').write_bytes(b'replay')
            manifest = json.dumps({'sessionId': 's1', 'segments': [{'name': name, 'bytes': 7,
                'sha256': hashlib.sha256(b'segment').hexdigest()}]})
            row = {'sessionId': 's1', 'tenantId': 't1', 'manifestJson': manifest,
                   'manifestSha256': hashlib.sha256(manifest.encode()).hexdigest(),
                   'replayBytes': 6, 'replaySha256': hashlib.sha256(b'replay').hexdigest()}
            self.assertEqual(audit.audit_recording(row, source, replay_root)[0], 'verified_recording')
            (segment_dir / name).write_bytes(b'changed')
            self.assertEqual(audit.audit_recording(row, source, replay_root)[0], 'segment_mismatch')


if __name__ == '__main__':
    unittest.main()
