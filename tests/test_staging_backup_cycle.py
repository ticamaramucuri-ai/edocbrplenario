"""Failure gates for the independent synthetic staging backup monitor."""

from datetime import datetime, timedelta, timezone
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parent.parent / 'scripts/staging-backup-cycle.py'
SPEC = importlib.util.spec_from_file_location('staging_backup_cycle', SCRIPT)
cycle = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(cycle)


class BackupCycleTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.vault = Path(self.temporary.name) / 'vault'
        self.vault.mkdir(mode=0o700)
        self.snapshot = self.vault / 'staging-20261107T000000Z-test.cms'
        self.snapshot.write_bytes(b'encrypted-example')
        self.digest = cycle.sha256(self.snapshot)
        self.manifest = 'a' * 64
        self.snapshot.with_suffix('.json').write_text(json.dumps({
            'ciphertextSha256': self.digest, 'manifestSha256': self.manifest}))
        self.config = {'vault': str(self.vault), 'maxAgeHours': 30, 'keep': 2}
        self.status = {'scope': 'synthetic-staging', 'lastAttempt': 'success',
                       'lastSuccessAt': datetime.now(timezone.utc).isoformat(),
                       'snapshotAt': datetime.now(timezone.utc).isoformat(),
                       'snapshot': str(self.snapshot), 'ciphertextSha256': self.digest,
                       'manifestSha256': self.manifest}
        cycle.write_status(self.vault, self.status)

    def test_healthy_snapshot_then_tampering_fails(self):
        self.assertTrue(cycle.check_cycle(self.config)['ok'])
        with self.snapshot.open('ab') as stream:
            stream.write(b'tampered')
        with self.assertRaisesRegex(RuntimeError, 'Hash'):
            cycle.check_cycle(self.config)

    def test_old_or_failed_attempt_is_not_healthy(self):
        self.status['snapshotAt'] = (datetime.now(timezone.utc) - timedelta(hours=31)).isoformat()
        cycle.write_status(self.vault, self.status)
        with self.assertRaisesRegex(RuntimeError, 'fora do prazo'):
            cycle.check_cycle(self.config)
        self.status['snapshotAt'] = datetime.now(timezone.utc).isoformat()
        self.status['lastAttempt'] = 'failed'
        cycle.write_status(self.vault, self.status)
        with self.assertRaisesRegex(RuntimeError, 'não foi bem-sucedida'):
            cycle.check_cycle(self.config)

    def test_overlapping_cycle_is_refused(self):
        lock = os.open(self.vault / '.backup.lock', os.O_CREAT | os.O_RDWR, 0o600)
        self.addCleanup(os.close, lock)
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with self.assertRaisesRegex(RuntimeError, 'andamento'):
            cycle.run_cycle(self.config)

    def test_failed_collection_preserves_previous_snapshot_and_opens_alarm(self):
        self.config.update({'cert': '/tmp/example-cert', 'key': '/tmp/example-key',
                            'remoteCert': '/tmp/example-cert', 'localSource': True})
        with patch.object(cycle.subprocess, 'run', return_value=cycle.subprocess.CompletedProcess([], 1, '', 'source failed')):
            with self.assertRaisesRegex(RuntimeError, 'Coleta'):
                cycle.run_cycle(self.config)
        status = cycle.read_status(self.vault)
        self.assertEqual(status['lastAttempt'], 'failed')
        self.assertEqual(status['snapshot'], str(self.snapshot))
        self.assertTrue(self.snapshot.is_file())
        with self.assertRaisesRegex(RuntimeError, 'não foi bem-sucedida'):
            cycle.check_cycle(self.config)


if __name__ == '__main__':
    unittest.main()
