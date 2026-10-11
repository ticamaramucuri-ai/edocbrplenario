#!/usr/bin/env python3
"""Copy a consistent SQLite snapshot into an empty PostgreSQL schema, then reconcile."""
import argparse
from contextlib import closing
import csv
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import io
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
from urllib.parse import parse_qs, unquote, urlsplit


def pg_env() -> dict[str, str]:
    parsed = urlsplit(os.environ.get('POSTGRES_COPY_URL', ''))
    if parsed.scheme not in ('postgres', 'postgresql') or not parsed.hostname or not parsed.path.strip('/'):
        raise ValueError('POSTGRES_COPY_URL deve ser uma URL PostgreSQL válida')
    env = os.environ.copy()
    env.update(PGHOST=parsed.hostname, PGPORT=str(parsed.port or 5432),
               PGDATABASE=unquote(parsed.path.lstrip('/')), PGUSER=unquote(parsed.username or ''),
               PGPASSWORD=unquote(parsed.password or ''))
    if 'sslmode' in (query := parse_qs(parsed.query)):
        env['PGSSLMODE'] = query['sslmode'][0]
    env.pop('POSTGRES_COPY_URL', None)
    return env


def query(env: dict[str, str], sql: str) -> str:
    result = subprocess.run(['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', sql],
                            env=env, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or 'consulta PostgreSQL falhou')
    return result.stdout.strip()


def ident(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def date_value(value: object) -> str:
    if isinstance(value, (int, float)) or (isinstance(value, str) and value.lstrip('-').isdigit()):
        parsed = datetime.fromtimestamp(int(value) / 1000, timezone.utc)
    else:
        parsed = datetime.fromisoformat(str(value).replace('Z', '+00:00').replace(' ', 'T'))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        else:
            parsed = parsed.astimezone(timezone.utc)
    return parsed.strftime('%Y-%m-%d %H:%M:%S.%f')[:-3]


def convert(value: object, data_type: str) -> object:
    if value is None:
        return None
    if data_type == 'timestamp without time zone':
        return date_value(value)
    if data_type == 'boolean':
        return 'true' if value in (1, True, '1', 'true', 'TRUE') else 'false'
    if data_type == 'bytea':
        return '\\x' + bytes(value).hex()
    return str(value)


def canonical_value(value: object, data_type: str) -> str:
    if value is None or value == '\\N':
        return '\\N'
    if data_type == 'timestamp without time zone':
        return date_value(value)
    if data_type == 'boolean':
        if str(value).lower() in ('1', 'true', 't'):
            return 'true'
        if str(value).lower() in ('0', 'false', 'f'):
            return 'false'
        raise ValueError('booleano inválido durante conciliação')
    if data_type == 'bytea':
        return ('\\x' + bytes(value).hex()) if isinstance(value, (bytes, bytearray, memoryview)) else str(value).lower()
    if data_type in ('integer', 'bigint', 'smallint', 'numeric', 'real', 'double precision'):
        return str(Decimal(str(value)).normalize())
    return str(value)


def order_tables(tables: set[str], edges: list[tuple[str, str]]) -> list[str]:
    parents = {table: set() for table in tables}
    children = {table: set() for table in tables}
    for child, parent in edges:
        if child != parent and child in tables and parent in tables:
            parents[child].add(parent)
            children[parent].add(child)
    ready = sorted(table for table in tables if not parents[table])
    result = []
    while ready:
        table = ready.pop(0)
        result.append(table)
        for child in sorted(children[table]):
            parents[child].discard(table)
            if not parents[child] and child not in result and child not in ready:
                ready.append(child)
        ready.sort()
    if len(result) != len(tables):
        raise RuntimeError('relações cíclicas impedem cópia com chaves estrangeiras ativas')
    return result


def canonical_hash(rows: object) -> tuple[int, str]:
    digest = hashlib.sha256()
    count = 0
    for row in rows:
        digest.update(json.dumps(list(row), ensure_ascii=False, separators=(',', ':')).encode())
        digest.update(b'\n')
        count += 1
    return count, digest.hexdigest()


def canonical_rows(rows: object, names: list[str], types: dict[str, str]) -> object:
    for row in rows:
        if len(row) != len(names):
            raise RuntimeError('número de colunas divergente durante conciliação')
        yield (canonical_value(value, types[name]) for name, value in zip(names, row))


def copy(source: Path, env: dict[str, str]) -> None:
    if not source.is_file():
        raise ValueError('arquivo SQLite de origem não encontrado')
    with tempfile.TemporaryDirectory(prefix='edocbr-pg-copy-') as directory:
        temporary = Path(directory)
        with closing(sqlite3.connect(source.resolve().as_uri() + '?mode=ro', uri=True)) as live, \
                closing(sqlite3.connect(temporary / 'snapshot.db')) as snapshot:
            live.backup(snapshot)
        snapshot = sqlite3.connect(temporary / 'snapshot.db')
        try:
            source_tables = {row[0] for row in snapshot.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}
            target_tables = set(query(env, "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_edocbr_schema_migration'").splitlines())
            if source_tables != target_tables:
                raise RuntimeError(f'tabelas divergentes: SQLite={len(source_tables)}, PostgreSQL={len(target_tables)}')
            if query(env, "SELECT to_regclass('public._edocbr_schema_migration') IS NOT NULL") != 't':
                raise RuntimeError('execute as migrações PostgreSQL antes da cópia')
            if query(env, "SELECT count(*) FROM \"_edocbr_schema_migration\" WHERE status='applied'") != '10':
                raise RuntimeError('migrações 0001 a 0010 devem estar aplicadas')
            edges = [tuple(line.split('|', 1)) for line in query(env, '''SELECT c.relname, p.relname
              FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid
              JOIN pg_class p ON p.oid=k.confrelid WHERE k.contype='f' AND k.connamespace='public'::regnamespace''').splitlines()]
            ordered = order_tables(source_tables, edges)
            metadata: dict[str, tuple[list[str], dict[str, str], int, str]] = {}
            copy_script = temporary / 'copy.sql'
            with copy_script.open('w') as commands:
                for table in ordered:
                    if int(query(env, f'SELECT count(*) FROM {ident(table)}')):
                        raise RuntimeError(f'destino não está vazio: {table}')
                    columns = [(row[1], row[5]) for row in snapshot.execute(f'PRAGMA table_info({ident(table)})')]
                    pg_columns = [tuple(line.split('|', 1)) for line in query(env, f"SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='{table}' ORDER BY ordinal_position").splitlines()]
                    source_names = [name for name, _ in columns]
                    pg_types = dict(pg_columns)
                    if set(source_names) != set(pg_types):
                        raise RuntimeError(f'colunas divergentes em {table}')
                    pk = [name for name, position in sorted(columns, key=lambda pair: pair[1]) if position]
                    if not pk:
                        raise RuntimeError(f'tabela sem chave primária: {table}')
                    order = ', '.join(ident(name) for name in pk)
                    data_file = temporary / f'{table}.csv'
                    count = 0
                    with data_file.open('w', newline='', encoding='utf-8') as output:
                        writer = csv.writer(output, lineterminator='\n')
                        for row in snapshot.execute(f'SELECT * FROM {ident(table)} ORDER BY {order}'):
                            converted = ['\\N' if value is None else convert(value, pg_types[name])
                                         for name, value in zip(source_names, row)]
                            if any(value == '\\N' and original is not None for value, original in zip(converted, row)):
                                raise ValueError(f'marcador NULL reservado encontrado em {table}')
                            writer.writerow(converted)
                            count += 1
                    metadata[table] = (source_names, pg_types, count, order)
                    if count:
                        cols = ', '.join(ident(name) for name in source_names)
                        commands.write(f"\\copy {ident(table)} ({cols}) FROM '{data_file}' WITH (FORMAT csv, NULL '\\N')\n")
                    commands.write(f'''DO $$ BEGIN IF (SELECT count(*) FROM {ident(table)}) <> {count}
                      THEN RAISE EXCEPTION 'contagem divergente em {table}'; END IF; END $$;\n''')
            result = subprocess.run(['psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-f', str(copy_script)],
                                    env=env, text=True, capture_output=True)
            if result.returncode:
                raise RuntimeError('cópia PostgreSQL falhou; transação revertida (restrição ou tipo incompatível)')
            total = 0
            for table in ordered:
                names, types, expected_count, order = metadata[table]
                cols = ', '.join(ident(name) for name in names)
                source_rows = snapshot.execute(f'SELECT {cols} FROM {ident(table)} ORDER BY {order}')
                source_count, source_hash = canonical_hash(canonical_rows(source_rows, names, types))
                sql = f"COPY (SELECT {cols} FROM {ident(table)} ORDER BY {order}) TO STDOUT WITH (FORMAT csv, NULL '\\N')"
                proc = subprocess.run(['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', sql],
                                      env=env, text=True, capture_output=True)
                if proc.returncode:
                    raise RuntimeError(proc.stderr.strip())
                target_count, target_hash = canonical_hash(canonical_rows(
                    csv.reader(io.StringIO(proc.stdout, newline='')), names, types))
                if source_count != expected_count or target_count != expected_count or source_hash != target_hash:
                    raise RuntimeError(f'valores divergentes em {table}')
                total += expected_count
            print(f'Cópia conciliada: {len(ordered)} tabelas, {total} linhas; todas as colunas preservadas.')
        finally:
            snapshot.close()


def main() -> None:
    parser = argparse.ArgumentParser(description='Cópia SQLite→PostgreSQL para destino vazio')
    parser.add_argument('--source', required=True, type=Path)
    args = parser.parse_args()
    copy(args.source, pg_env())


if __name__ == '__main__':
    try:
        main()
    except (ValueError, RuntimeError, sqlite3.Error, OSError) as error:
        print(f'Erro: {error}', file=sys.stderr)
        sys.exit(1)
