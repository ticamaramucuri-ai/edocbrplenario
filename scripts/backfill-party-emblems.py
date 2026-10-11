#!/usr/bin/env python3
"""Reconcile legacy member emblems into Party; abort on ambiguous values."""
import argparse
import sqlite3
from pathlib import Path
from uuid import uuid4

parser = argparse.ArgumentParser()
parser.add_argument('--source', type=Path, required=True)
args = parser.parse_args()
with sqlite3.connect(args.source) as db:
    db.row_factory = sqlite3.Row
    db.execute('BEGIN IMMEDIATE')
    conflicts = db.execute('''SELECT tenantId, party, COUNT(DISTINCT partyEmblemUrl) AS n
                              FROM Parliamentarian WHERE partyEmblemUrl IS NOT NULL
                              GROUP BY tenantId, party HAVING n > 1''').fetchall()
    if conflicts:
        raise SystemExit(f'Conflitos de emblema por Câmara/partido: {len(conflicts)}. Resolver antes da migração.')
    groups = db.execute('''SELECT tenantId, party, MIN(partyEmblemUrl) AS emblemUrl
                           FROM Parliamentarian WHERE partyEmblemUrl IS NOT NULL
                           GROUP BY tenantId, party''').fetchall()
    for row in groups:
        current = db.execute('SELECT id, emblemUrl FROM Party WHERE tenantId=? AND acronym=?',
                             (row['tenantId'], row['party'])).fetchone()
        if current and current['emblemUrl'] and current['emblemUrl'] != row['emblemUrl']:
            raise SystemExit('Conflito entre emblema do partido e do parlamentar; nenhuma alteração aplicada.')
        if current:
            db.execute('UPDATE Party SET emblemUrl=? WHERE id=?', (row['emblemUrl'], current['id']))
        else:
            db.execute('''INSERT INTO Party (id, tenantId, acronym, name, number, emblemUrl, active, createdAt, updatedAt)
                          VALUES (?, ?, ?, ?, NULL, ?, 1, strftime('%s','now')*1000, strftime('%s','now')*1000)''',
                       ('legacy-party-' + uuid4().hex, row['tenantId'], row['party'], row['party'], row['emblemUrl']))
        db.execute('''UPDATE Parliamentarian SET partyEmblemUrl=? WHERE tenantId=? AND party=?''',
                   (row['emblemUrl'], row['tenantId'], row['party']))
    db.commit()
print(f'Partidos com emblema legado reconciliados: {len(groups)}')
