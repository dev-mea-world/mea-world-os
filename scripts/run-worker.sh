#!/bin/zsh
set -euo pipefail

SCRIPT_DIR=${0:A:h}
REPO_ROOT=${SCRIPT_DIR:h}
ENV_FILE="$REPO_ROOT/.env.local"

if [[ ! -f "$ENV_FILE" ]]; then
  print -u2 "Missing $ENV_FILE"
  exit 1
fi

cd "$REPO_ROOT"
exec node scripts/worker-supervisor.mjs
