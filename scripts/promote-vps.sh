#!/usr/bin/env bash
# Operador local: confirma CI do main e promove exatamente esse commit na VPS.
set -euo pipefail
repo='e-docBR/edocBRplenario'
target="${EDOCBR_VPS_SSH_TARGET:?Defina EDOCBR_VPS_SSH_TARGET para a VPS de homologação.}"
commit="${1:-$(git rev-parse HEAD)}"
[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || { echo 'Informe SHA Git completo.' >&2; exit 2; }
git fetch origin main
[[ "$(git rev-parse refs/remotes/origin/main)" == "$commit" ]] || {
  echo 'O commit solicitado ainda não é origin/main.' >&2; exit 2;
}
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo 'Há mudanças rastreadas locais; conclua-as antes de promover.' >&2
  exit 2
fi
ci="$(gh run list --repo "$repo" --workflow CI --commit "$commit" --limit 20 --json headSha,status,conclusion)"
python3 - "$commit" "$ci" <<'PY'
import json,sys
commit, raw = sys.argv[1:]
runs = [run for run in json.loads(raw) if run['headSha'] == commit]
if not runs or any(run['status'] != 'completed' or run['conclusion'] != 'success' for run in runs):
    raise SystemExit('CI do commit ainda não está verde; promoção recusada.')
PY
options=(-o BatchMode=yes -o StrictHostKeyChecking=yes)
if [[ -n "${EDOCBR_VPS_SSH_IDENTITY:-}" ]]; then
  options+=(-i "$EDOCBR_VPS_SSH_IDENTITY" -o IdentitiesOnly=yes)
fi
ssh "${options[@]}" "$target" "bash -s -- $commit" <<'REMOTE'
set -euo pipefail
commit="$1"
cd /home/suporteplenario/edocbr-plenario
test -z "$(git status --porcelain --untracked-files=no)"
git fetch --prune origin main
test "$(git rev-parse refs/remotes/origin/main)" = "$commit"
git checkout --quiet --detach "$commit"
python3 scripts/staging-promote.py --commit "$commit"
REMOTE
