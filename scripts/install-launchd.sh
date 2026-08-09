#!/bin/zsh
set -euo pipefail

SCRIPT_DIR=${0:A:h}
REPO_ROOT=${SCRIPT_DIR:h}
TEMPLATE="$SCRIPT_DIR/com.meaworld.company-os-worker.plist.template"
SOURCE_ENV_FILE="$REPO_ROOT/.env.local"
TARGET_DIR="$HOME/Library/LaunchAgents"
TARGET="$TARGET_DIR/com.meaworld.company-os-worker.plist"
LABEL="com.meaworld.company-os-worker"
SERVICE_DOMAIN="gui/$(id -u)"
RUNTIME_BASE="$HOME/Library/Application Support/MeaWorld Company OS"
RUNTIME_REPO="$RUNTIME_BASE/repository"
RUNTIME_ENV="$RUNTIME_REPO/.env.local"
TEMP_FILE=$(mktemp "${TMPDIR:-/tmp}/meaworld-worker.XXXXXX")
trap 'rm -f "$TEMP_FILE"' EXIT

PNPM_BIN=$(command -v pnpm || true)
NODE_BIN=$(command -v node || true)
if [[ -z "$PNPM_BIN" || -z "$NODE_BIN" ]]; then
  print -u2 "Both node and pnpm must be available while installing the worker"
  exit 1
fi
if [[ ! -f "$SOURCE_ENV_FILE" ]]; then
  print -u2 "Missing $SOURCE_ENV_FILE"
  exit 1
fi
WORKER_RUNTIME_PATH="${NODE_BIN:h}:${PNPM_BIN:h}:/usr/bin:/bin:/usr/sbin:/sbin"

if [[ "${1:-}" != "--install-only" ]] && launchctl print "$SERVICE_DOMAIN/$LABEL" >/dev/null 2>&1; then
  launchctl bootout "$SERVICE_DOMAIN/$LABEL"
  for unload_check in {1..20}; do
    if ! launchctl print "$SERVICE_DOMAIN/$LABEL" >/dev/null 2>&1; then
      break
    fi
    sleep 0.25
  done
fi

mkdir -p "$REPO_ROOT/.phase0"
mkdir -p "$TARGET_DIR"
mkdir -p "$RUNTIME_BASE"

if [[ ! -d "$RUNTIME_REPO/.git" ]]; then
  git clone --no-hardlinks "$REPO_ROOT" "$RUNTIME_REPO"
fi
if [[ "$RUNTIME_REPO" != "$RUNTIME_BASE/repository" || ! -d "$RUNTIME_REPO/.git" ]]; then
  print -u2 "Refusing to synchronize an unexpected runtime repository path"
  exit 1
fi

ORIGIN_URL=$(git -C "$REPO_ROOT" remote get-url origin)
git -C "$RUNTIME_REPO" remote set-url origin "$ORIGIN_URL"
rsync -a --delete \
  --exclude '.git/' \
  --exclude '.next/' \
  --exclude '.phase0/' \
  --exclude '.env.local' \
  --exclude 'node_modules/' \
  "$REPO_ROOT/" "$RUNTIME_REPO/"
install -m 600 "$SOURCE_ENV_FILE" "$RUNTIME_ENV"
sed -i '' -e "s|^CODEX_WORKING_DIRECTORY=.*$|CODEX_WORKING_DIRECTORY=\"$RUNTIME_REPO\"|" "$RUNTIME_ENV"
mkdir -p "$RUNTIME_REPO/.phase0"

(
  cd "$RUNTIME_REPO"
  pnpm install --offline --frozen-lockfile
)

sed \
  -e "s|__NODE_BIN__|$NODE_BIN|g" \
  -e "s|__RUNTIME_REPO__|$RUNTIME_REPO|g" \
  -e "s|__RUNTIME_PATH__|$WORKER_RUNTIME_PATH|g" \
  "$TEMPLATE" > "$TEMP_FILE"
plutil -lint "$TEMP_FILE"
install -m 600 "$TEMP_FILE" "$TARGET"

print "Installed $TARGET"
print "Synchronized isolated runtime $RUNTIME_REPO"
if [[ "${1:-}" == "--install-only" ]]; then
  print "Installed without loading (--install-only)."
  exit 0
fi

launchctl bootstrap "$SERVICE_DOMAIN" "$TARGET"
launchctl kickstart -k "$SERVICE_DOMAIN/$LABEL"
launchctl print "$SERVICE_DOMAIN/$LABEL" >/dev/null
print "Loaded $LABEL under $SERVICE_DOMAIN"
