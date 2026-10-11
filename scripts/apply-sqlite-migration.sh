#!/usr/bin/env bash
set -euo pipefail

db_path="${1:-}"
sql_path="${2:-}"
[[ -n "$db_path" && -f "$db_path" && -n "$sql_path" && -f "$sql_path" ]] || {
  echo 'Uso: scripts/apply-sqlite-migration.sh CAMINHO_DB CAMINHO_SQL' >&2
  exit 2
}
command -v sqlite3 >/dev/null || { echo 'sqlite3 ausente' >&2; exit 2; }

backup="${db_path}.backup.$(date -u +%Y%m%dT%H%M%SZ)"
sqlite3 "$db_path" ".backup '$backup'"
echo "Backup: $backup"
{
  printf 'PRAGMA foreign_keys=ON;\nBEGIN IMMEDIATE;\n'
  cat "$sql_path"
  printf '\nCOMMIT;\nPRAGMA integrity_check;\n'
} | sqlite3 -bail "$db_path"
echo "Migração aplicada: $sql_path"
