#!/bin/zsh
set -euo pipefail

SCRIPT_DIR=${0:A:h}
REPO_ROOT=${SCRIPT_DIR:h}
TEMPLATE="$SCRIPT_DIR/com.meaworld.company-os-worker.plist.template"
TARGET_DIR="$HOME/Library/LaunchAgents"
TARGET="$TARGET_DIR/com.meaworld.company-os-worker.plist"
TEMP_FILE=$(mktemp "${TMPDIR:-/tmp}/meaworld-worker.XXXXXX.plist")
trap 'rm -f "$TEMP_FILE"' EXIT

PNPM_BIN=$(command -v pnpm || true)
NODE_BIN=$(command -v node || true)
if [[ -z "$PNPM_BIN" || -z "$NODE_BIN" ]]; then
  print -u2 "Both node and pnpm must be available while installing the worker"
  exit 1
fi
WORKER_RUNTIME_PATH="${NODE_BIN:h}:${PNPM_BIN:h}:/usr/bin:/bin:/usr/sbin:/sbin"

mkdir -p "$REPO_ROOT/.phase0"
mkdir -p "$TARGET_DIR"
sed \
  -e "s|__REPO_ROOT__|$REPO_ROOT|g" \
  -e "s|__RUNTIME_PATH__|$WORKER_RUNTIME_PATH|g" \
  "$TEMPLATE" > "$TEMP_FILE"
plutil -lint "$TEMP_FILE"
install -m 600 "$TEMP_FILE" "$TARGET"

print "Installed $TARGET"
print "Review it, then load explicitly with:"
print "  launchctl bootstrap gui/$UID $TARGET"
