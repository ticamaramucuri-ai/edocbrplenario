"""Read-only probes for the isolated local staging stack."""
import json
from pathlib import Path
import subprocess
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / 'deploy/staging/.env'
COMPOSE = ROOT / 'deploy/staging/compose.yaml'
values = dict(line.split('=', 1) for line in CONFIG.read_text().splitlines()
              if '=' in line and not line.startswith('#'))
URLS = {
    'app': f"http://127.0.0.1:{values.get('STAGE_APP_PORT', '3100')}/api/v1/bootstrap",
    'realtime': f"http://127.0.0.1:{values.get('STAGE_REALTIME_PORT', '3103')}/health",
    'mailpit': f"http://127.0.0.1:{values.get('STAGE_MAILPIT_PORT', '3125')}/api/v1/messages",
}
EXPECTED_SERVICES = {'postgres', 'redis', 'app', 'realtime', 'webhooks', 'scheduler', 'mail_worker', 'mailpit'}


def verify_synthetic_scope():
    with urlopen(URLS['app'], timeout=5) as response:
        tenant = json.load(response).get('tenant') or {}
    if tenant.get('slug') != 'staging-example':
        raise RuntimeError('Observação permitida somente na stack sintética staging-example.')


def probe():
    failures = []
    for name, url in URLS.items():
        try:
            with urlopen(url, timeout=3) as response:
                if response.status != 200:
                    failures.append(f'{name}:HTTP_{response.status}')
                response.read(128)
        except Exception:
            failures.append(f'{name}:unavailable')
    try:
        result = subprocess.run(['docker', 'compose', '--env-file', str(CONFIG), '-f', str(COMPOSE),
                                 '--profile', 'mail-lab', 'ps', '--format', 'json'],
                                cwd=ROOT, capture_output=True, text=True, check=True)
        rows = [json.loads(line) for line in result.stdout.splitlines() if line.strip()]
    except (OSError, subprocess.CalledProcessError, ValueError, KeyError):
        return sorted(failures + ['docker:unavailable'])
    found = {row['Service'] for row in rows}
    failures.extend(f'{name}:missing' for name in sorted(EXPECTED_SERVICES - found))
    failures.extend(f"{row['Service']}:{row['State']}/{row['Health']}" for row in rows
                    if row['Service'] in EXPECTED_SERVICES and
                    (row['State'] != 'running' or row['Health'] != 'healthy'))
    return sorted(failures)
