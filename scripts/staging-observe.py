#!/usr/bin/env python3
"""Host-side independent probe around a bounded synthetic write run."""
import json
from pathlib import Path
import subprocess
import sys
import time
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / 'deploy/staging/.env'
COMPOSE = ROOT / 'deploy/staging/compose.yaml'
values = dict(line.split('=', 1) for line in CONFIG.read_text().splitlines()
              if '=' in line and not line.startswith('#'))
urls = {
    'app': f"http://127.0.0.1:{values.get('STAGE_APP_PORT', '3100')}/api/v1/bootstrap",
    'realtime': f"http://127.0.0.1:{values.get('STAGE_REALTIME_PORT', '3103')}/health",
    'mailpit': f"http://127.0.0.1:{values.get('STAGE_MAILPIT_PORT', '3125')}/api/v1/messages",
}
expected_services = {'postgres', 'app', 'realtime', 'webhooks', 'scheduler', 'mail_worker', 'mailpit'}
duration = 45
interval = 2


def probe():
    failures = []
    for name, url in urls.items():
        try:
            with urlopen(url, timeout=3) as response:
                if response.status != 200:
                    failures.append(f'{name}:HTTP_{response.status}')
                response.read(128)
        except Exception:
            failures.append(f'{name}:unavailable')
    result = subprocess.run(['docker', 'compose', '--env-file', str(CONFIG), '-f', str(COMPOSE),
                             '--profile', 'mail-lab', 'ps', '--format', 'json'],
                            cwd=ROOT, capture_output=True, text=True, check=True)
    rows = [json.loads(line) for line in result.stdout.splitlines() if line.strip()]
    found = {row['Service'] for row in rows}
    failures.extend(f'{name}:missing' for name in sorted(expected_services - found))
    failures.extend(f"{row['Service']}:{row['State']}/{row['Health']}" for row in rows
                    if row['Service'] in expected_services and
                    (row['State'] != 'running' or row['Health'] != 'healthy'))
    return failures


# The test is deliberately confined to this local synthetic stack.
assert 'staging-example' in urlopen(urls['app'], timeout=5).read().decode()
initial_issues = probe()
if initial_issues:
    raise RuntimeError(f'A stack precisa estar saudável antes do observador: {initial_issues}')
writer = subprocess.Popen([sys.executable, str(ROOT / 'scripts/staging-vote-load.py')],
                          cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
started = time.monotonic()
samples = 0
failed_samples = []
try:
    while time.monotonic() - started < duration or writer.poll() is None:
        if time.monotonic() - started > 180:
            raise RuntimeError('A carga de escrita excedeu o limite de 180 segundos.')
        issues = probe()
        samples += 1
        if issues:
            failed_samples.append({'sample': samples, 'issues': issues})
        time.sleep(interval)
finally:
    if writer.poll() is None:
        writer.terminate()
stdout, stderr = writer.communicate(timeout=5)
if writer.returncode:
    raise RuntimeError(f'Ensaio de escrita falhou: {stderr[-1000:]}')
write_result = json.loads(stdout)
summary = {'ok': not failed_samples and write_result['ok'], 'synthetic': True,
           'observer': 'host independente dos processos da stack, mesmo computador',
           'samples': samples, 'durationSeconds': round(time.monotonic() - started, 2),
           'failedSamples': failed_samples, 'writeLoad': write_result}
print(json.dumps(summary, sort_keys=True))
if not summary['ok']:
    raise SystemExit(1)
