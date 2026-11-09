#!/usr/bin/env bash
# Cross-compile the Windows x64 local synchronization executable; runtime validation requires Windows.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output="${1:-$root/dist/local-server/edocbr-local-server.exe}"
if [[ "$output" != /* || "$output" != *.exe ]]; then
  echo 'A saída deve ser um caminho absoluto terminado em .exe.' >&2
  exit 2
fi
mkdir -p "$(dirname "$output")"
umask 077
bun build --compile --target=bun-windows-x64 --no-compile-autoload-dotenv \
  --no-compile-autoload-bunfig "$root/scripts/local-server.ts" --outfile "$output"
sha256sum "$output" > "$output.sha256"
echo "Executável: $output"
cat "$output.sha256"
