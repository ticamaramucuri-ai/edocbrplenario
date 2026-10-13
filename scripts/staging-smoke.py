#!/usr/bin/env python3
"""Jornada mínima HTTP sobre o stack sintético, sem tocar localhost:3000."""
import http.cookiejar
import json
import time
from pathlib import Path
from urllib.request import HTTPCookieProcessor, Request, build_opener

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / 'deploy/staging/.env'
values = dict(line.split('=', 1) for line in CONFIG.read_text().splitlines() if '=' in line and not line.startswith('#'))
base = f"http://127.0.0.1:{values.get('STAGE_APP_PORT', '3100')}"
opener = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))


def call(path: str, payload=None):
    body = None if payload is None else json.dumps(payload).encode()
    req = Request(base + path, body, {'Content-Type': 'application/json'} if body else {})
    with opener.open(req, timeout=10) as response:
        return response.status, json.load(response)


for attempt in range(20):
    try:
        _, bootstrap = call('/api/v1/bootstrap')
        break
    except (OSError, TimeoutError):
        if attempt == 19:
            raise
        time.sleep(0.5)
assert bootstrap['tenant']['slug'] == 'staging-example'
_, login = call('/api/v1/auth/login', {
    'email': 'stage-admin@example.invalid', 'password': values['STAGE_ADMIN_PASSWORD']})
assert login['actor']['role'] == 'tenant_admin'
_, people = call('/api/v1/parliamentarians')
president = next((p for p in people['parliamentarians'] if p['name'] == 'Presidente de Ensaio'), None)
if not president:
    status, created = call('/api/v1/parliamentarians', {
        'name': 'Presidente de Ensaio', 'party': 'EXP', 'boardRole': 'presidente'})
    assert status == 201
    president = created['parliamentarian']
_, sessions = call('/api/v1/sessions')
draft = next((s for s in sessions['sessions'] if s.get('notes') == 'Ensaio sintético de homologação PostgreSQL'), None)
if not draft:
    from datetime import datetime, timedelta, timezone
    status, created = call('/api/v1/sessions', {
        'type': 'ordinaria',
        'scheduledAt': (datetime.now(timezone.utc) + timedelta(days=30)).isoformat(),
        'presidentId': president['id'],
        'notes': 'Ensaio sintético de homologação PostgreSQL',
    })
    assert status == 201
    draft = created['session']
_, public = call('/api/v1/public/sessions?tenant=staging-example')
assert all(s['id'] != draft['id'] for s in public['sessions'])
print(json.dumps({'ok': True, 'tenant': 'staging-example', 'login': True,
                  'parliamentarianId': president['id'], 'draftSessionId': draft['id'],
                  'draftHiddenFromPublic': True}, ensure_ascii=False))
