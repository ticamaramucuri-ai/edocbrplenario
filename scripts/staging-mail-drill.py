#!/usr/bin/env python3
"""Exercise PostgreSQL queue -> TLS SMTP -> local capture, then retry, on synthetic tenant."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time
from urllib.request import urlopen
from uuid import uuid4

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / 'deploy/staging/.env'
values = dict(line.split('=', 1) for line in CONFIG.read_text().splitlines()
              if '=' in line and not line.startswith('#'))
env = {**os.environ, 'PGHOST': '127.0.0.1', 'PGPORT': values.get('STAGE_DB_PORT', '55432'),
       'PGUSER': 'edocbr_stage', 'PGDATABASE': 'edocbr_stage',
       'PGPASSWORD': values['STAGE_DB_PASSWORD']}
mailpit = f"http://127.0.0.1:{values.get('STAGE_MAILPIT_PORT', '3125')}"


def query(sql):
    result = subprocess.run(['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', sql],
                            cwd=ROOT, env=env, text=True, capture_output=True, check=True)
    return result.stdout.strip()


def messages():
    with urlopen(mailpit + '/api/v1/messages', timeout=5) as response:
        return json.load(response)['messages']


def wait_for(check, label):
    deadline = time.monotonic() + 35
    while time.monotonic() < deadline:
        result = check()
        if result:
            return result
        time.sleep(1)
    raise RuntimeError(f'Tempo excedido: {label}')


if query('SELECT count(*) FROM "Tenant"') != '1':
    raise RuntimeError('Ensaio permitido somente na base sintética exclusiva.')
tenant_id = query("SELECT id FROM \"Tenant\" WHERE slug='staging-example'")
if not tenant_id or not tenant_id.isalnum():
    raise RuntimeError('Tenant sintético ausente.')
if not query("SELECT id FROM \"Session\" WHERE id='stage-media-recovery'"):
    raise RuntimeError('Execute scripts/staging-media-drill.py antes do correio.')
messages()  # Falha cedo se o capturador não estiver ativo.


def create_delivery(recipient):
    subscription_id, delivery_id, token = str(uuid4()), str(uuid4()), str(uuid4())
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    query('BEGIN; INSERT INTO "CitizenSubscription" '
          '(id, "tenantId", email, "targetKind", "targetId", token, "createdAt") '
          f"VALUES ('{subscription_id}', '{tenant_id}', '{recipient}', 'session', "
          f"'stage-media-recovery', '{token}', now()); "
          'INSERT INTO "MailDelivery" '
          '(id, "tenantId", "subscriptionId", "tokenHash", status, attempts, "createdAt") '
          f"VALUES ('{delivery_id}', '{tenant_id}', '{subscription_id}', '{token_hash}', "
          "'pending', 0, now()); COMMIT;")
    return delivery_id, subscription_id


run_id = uuid4().hex[:12]
good = f'stage-mail-{run_id}@example.invalid'
delivery_id, _ = create_delivery(good)
wait_for(lambda: query(f"SELECT status FROM \"MailDelivery\" WHERE id='{delivery_id}'") == 'sent',
         'entrega SMTP com STARTTLS')
wait_for(lambda: any(good in [t['Address'] for t in m['To']] for m in messages()),
         'mensagem capturada')

bad = f'stage-retry-{run_id}@example.com'
retry_id, subscription_id = create_delivery(bad)
wait_for(lambda: query(f"SELECT attempts FROM \"MailDelivery\" WHERE id='{retry_id}'") == '1',
         'rejeição do destinatário fora de example.invalid')
if query(f"SELECT status FROM \"MailDelivery\" WHERE id='{retry_id}'") != 'pending':
    raise RuntimeError('Falha SMTP não voltou à fila.')
recovered = f'stage-retry-{run_id}@example.invalid'
query('BEGIN; UPDATE "CitizenSubscription" '
      f"SET email='{recovered}' WHERE id='{subscription_id}'; "
      f"UPDATE \"MailDelivery\" SET \"nextAttemptAt\"=now() WHERE id='{retry_id}'; COMMIT;")
wait_for(lambda: query(f"SELECT status FROM \"MailDelivery\" WHERE id='{retry_id}'") == 'sent',
         'retentativa')
wait_for(lambda: any(recovered in [t['Address'] for t in m['To']] for m in messages()),
         'retentativa capturada')
attempts = int(query(f"SELECT attempts FROM \"MailDelivery\" WHERE id='{retry_id}'"))
if attempts != 2:
    raise RuntimeError(f'Esperadas duas tentativas; observadas {attempts}.')
print(json.dumps({'ok': True, 'synthetic': True, 'tls': 'STARTTLS verificado pelo cliente',
                  'firstDelivery': 'sent', 'retryDelivery': 'sent', 'retryAttempts': attempts,
                  'captureCount': len(messages()), 'externalDelivery': False}, sort_keys=True))
