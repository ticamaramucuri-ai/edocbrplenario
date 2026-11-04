#!/usr/bin/env python3
"""Impede que uma variável antiga publique serviços do staging fora do loopback."""
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
env = {**os.environ,
       'STAGE_DB_PASSWORD': 'synthetic-test-only',
       'STAGE_REALTIME_SECRET': 'synthetic-test-only',
       'STAGE_BIND': '0.0.0.0',
       'STAGE_GATEWAY_BIND': '0.0.0.0'}
result = subprocess.run(
    ['docker', 'compose', '-f', str(ROOT / 'deploy/staging/compose.yaml'),
     'config', '--format', 'json'],
    cwd=ROOT, env=env, check=True, capture_output=True, text=True)
services = json.loads(result.stdout)['services']
for name, service in services.items():
    for port in service.get('ports', []):
        assert port['host_ip'] == '127.0.0.1', (name, port)
assert services['gateway']['ports'][0]['target'] == 80
assert services['app']['build']['args']['NEXT_PUBLIC_REALTIME_URL'] == ''
print('Gateway, app, banco e demais portas vinculados somente ao loopback.')
