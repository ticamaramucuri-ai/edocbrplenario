#!/usr/bin/env bash
# Build the Linux x64 local synchronization executable; no institutional credentials enter this step.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output="${1:-$root/dist/local-server/edocbr-local-server}"
if [[ "$output" != /* ]]; then
  echo 'O caminho de saída deve ser absoluto.' >&2
  exit 2
fi
mkdir -p "$(dirname "$output")"
umask 077
bun build --compile --no-compile-autoload-dotenv --no-compile-autoload-bunfig \
  "$root/scripts/local-server.ts" --outfile "$output"
chmod 0750 "$output"
sha256sum "$output" > "$output.sha256"
echo "Executável: $output"
cat "$output.sha256"
