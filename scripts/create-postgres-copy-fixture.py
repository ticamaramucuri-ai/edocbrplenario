#!/usr/bin/env python3
"""Synthetic SQLite data for the cross-provider copy test. Never reads the pilot DB."""
import hashlib
from pathlib import Path
import sqlite3
import sys
import time


db = sqlite3.connect(Path(sys.argv[1]))
db.execute('PRAGMA foreign_keys=ON')
now = int(time.time() * 1000)
tenant_a = 'cfixturea00000000000000001'
tenant_b = 'cfixtureb00000000000000002'
for tenant_id, slug, name in [(tenant_a, 'fixture-a', 'Câmara A'), (tenant_b, 'fixture-b', 'Câmara B')]:
    db.execute('INSERT INTO "Tenant" (id, slug, name, city, uf, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
               (tenant_id, slug, name, 'Teste', 'BA', now))
    db.execute('INSERT INTO "Session" (id, tenantId, number, year, scheduledAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
               (f'session-{slug}', tenant_id, 1, 2026, now + 86400_000, now))
    chain_hash = hashlib.sha256(f'{tenant_id}:votação'.encode()).hexdigest()
    db.execute('''INSERT INTO "AuditEvent" (id, tenantId, actorName, actorRole, action,
               aggregateType, summary, chainHash, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)''',
               (f'audit-{slug}', tenant_id, 'Operador', 'tenant_admin', 'session.created',
                'session', 'Sessão criada\ncom pauta de teste', chain_hash,
                '2026-10-11 12:34:56' if tenant_id == tenant_b else now))
    db.execute('''INSERT INTO "OutboxEvent" (id, tenantId, eventType, aggregateId,
               internalPayload, publicPayload, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)''',
               (f'outbox-{slug}', tenant_id, 'session.created', f'session-{slug}',
                '{"title":"Sessão pública","internal":"restrito"}', '{"title":"Sessão pública"}', now))
db.execute('''INSERT INTO "WebhookEndpoint" (id, tenantId, url, secret, events, updatedAt)
              VALUES (?, ?, ?, ?, ?, ?)''',
           ('endpoint-a', tenant_a, 'https://example.invalid/hook', 'segredo-ficticio', '["session.created"]', now))
db.execute('''INSERT INTO "WebhookDelivery" (id, endpointId, eventType, payload, createdAt)
              VALUES (?, ?, ?, ?, ?)''',
           ('delivery-a', 'endpoint-a', 'session.created', '{"tenantId":"cfixturea00000000000000001"}', now))
db.commit()
db.close()
