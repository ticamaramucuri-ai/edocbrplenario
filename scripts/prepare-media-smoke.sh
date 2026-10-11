#!/usr/bin/env bash
# Baixa MediaMTX somente para ensaio local e confere checksum oficial.
set -euo pipefail
version="v1.21.2"
[[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]] || { echo 'Este auxiliar suporta Linux x86_64.' >&2; exit 2; }
for bin in curl sha256sum tar; do command -v "$bin" >/dev/null || { echo "$bin ausente" >&2; exit 2; }; done
directory="${MEDIAMTX_TEST_DIR:-/tmp/edocbr-mediamtx-$version}"
mkdir -p "$directory"
asset="mediamtx_${version}_linux_amd64.tar.gz"
base="https://github.com/bluenviron/mediamtx/releases/download/$version"
curl -fsSL "$base/$asset" -o "$directory/$asset"
curl -fsSL "$base/checksums.sha256" -o "$directory/checksums.sha256"
(
  cd "$directory"
  awk -v asset="*$asset" '$2 == asset { print }' checksums.sha256 | sha256sum --check
  tar -xzf "$asset" mediamtx
)
"$directory/mediamtx" --version
echo "MEDIAMTX_BIN=$directory/mediamtx"
