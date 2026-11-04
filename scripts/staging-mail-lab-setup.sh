#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
certs="$root/deploy/staging/mail-lab/certs"
mkdir -p "$certs"
chmod 700 "$root/deploy/staging/mail-lab" "$certs"
if [[ ! -s "$certs/mailpit.crt" || ! -s "$certs/mailpit.key" ]] ||
   ! openssl x509 -checkend 86400 -noout -in "$certs/mailpit.crt" >/dev/null 2>&1; then
  openssl req -x509 -newkey rsa:2048 -sha256 -nodes -days 30 \
    -keyout "$certs/mailpit.key" -out "$certs/mailpit.crt" \
    -subj '/CN=mailpit' -addext 'subjectAltName=DNS:mailpit' >/dev/null 2>&1
  chmod 600 "$certs/mailpit.key"
  chmod 644 "$certs/mailpit.crt"
fi
echo 'Certificado de ensaio pronto (somente rede Docker local).'
