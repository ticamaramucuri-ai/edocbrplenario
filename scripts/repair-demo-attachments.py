#!/usr/bin/env python3
"""Remove only three known dead demo URLs, preserving real tenant data."""
import argparse
import os
from pathlib import Path
import sqlite3


DEMO = {
    '/download/pl43-substitutivo.pdf',
    '/download/pl43-parecer-ccj.pdf',
    '/download/pl46-mensagem.pdf',
}


def main() -> None:
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    source = args.source.resolve()
    if not source.is_file():
        raise SystemExit('SQLite não encontrado')
    with sqlite3.connect(source.as_uri() + '?mode=ro', uri=True) as db:
        rows = db.execute('''SELECT a.id, a.url, t.slug FROM MatterAttachment a
            JOIN LegislativeMatter m ON m.id=a.matterId JOIN Tenant t ON t.id=m.tenantId
            WHERE a.url IN (?,?,?)''', tuple(sorted(DEMO))).fetchall()
        if any(slug != 'camara-vila-nova' for _, _, slug in rows):
            raise SystemExit('URL do seed encontrada fora da Câmara fictícia; nada alterado')
        if len(rows) not in (0, 3) or len({url for _, url, _ in rows}) != len(rows):
            raise SystemExit('Conjunto demonstrativo inesperado; nada alterado')
        print(f'URLs fictícias elegíveis: {len(rows)}')
        if not args.apply or not rows:
            return
        backup = source.with_name(source.name + '.backup.stage039')
        if backup.exists():
            raise SystemExit('Backup da etapa já existe; inspecione antes de reaplicar')
        with sqlite3.connect(backup) as destination:
            db.backup(destination)
        backup.chmod(0o600)
    with sqlite3.connect(source) as db:
        db.execute('BEGIN IMMEDIATE')
        for row_id, url, _ in rows:
            result = db.execute('''UPDATE MatterAttachment SET url=NULL, sizeBytes=0
                WHERE id=? AND url=?''', (row_id, url))
            if result.rowcount != 1:
                raise RuntimeError('Registro mudou desde o snapshot; transação revertida')
        if db.execute('PRAGMA foreign_key_check').fetchone():
            raise RuntimeError('Chave estrangeira inválida; transação revertida')
        db.commit()
    print(f'Corrigidos {len(rows)} metadados demonstrativos; backup privado criado.')


if __name__ == '__main__':
    main()
