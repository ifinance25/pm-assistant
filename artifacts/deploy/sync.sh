#!/usr/bin/env bash
# rsync кода app/ и deploy-скриптов на EC2. Запускать с Mac.
set -euo pipefail

KEY="${PM_ASSISTANT_SSH_KEY:-/Users/ifinance/Documents/AI2026/AWS Server/TEST Key.pem}"
HOST="${PM_ASSISTANT_HOST:-ubuntu@16.171.52.89}"
VAULT="${PM_ASSISTANT_VAULT:-/Users/ifinance/Documents/Obsidian/MyKnowledgeBase}"
APP_SRC="$VAULT/Projects/PM Assistant/app/"
DEPLOY_SRC="$VAULT/Projects/PM Assistant/artifacts/deploy/"
RSH="ssh -i \"$KEY\" -o IdentitiesOnly=yes -o ServerAliveInterval=30"

if [ ! -f "$KEY" ]; then
  echo "нет SSH-ключа: $KEY" >&2
  exit 1
fi
if [ ! -d "$APP_SRC" ] || [ ! -d "$DEPLOY_SRC" ]; then
  echo "нет исходников app/ или deploy/" >&2
  exit 1
fi

HERE="$(cd "$(dirname "$0")" && pwd)"
CHANGELOG="$VAULT/Projects/PM Assistant/CHANGELOG.md"

if [ "${SKIP_RELEASE_NOTES:-}" != "1" ]; then
  echo "[sync] история релизов"
  node "$HERE/record-release.mjs"
fi

echo "[sync] $HOST app/ + deploy/"
rsync -az --delete \
  -e "$RSH" \
  --exclude node_modules \
  --exclude data \
  --exclude .env \
  --exclude bot/zoom-web/node_modules \
  "$APP_SRC" "$HOST:/opt/pm-assistant/app/"

rsync -az \
  -e "$RSH" \
  "$DEPLOY_SRC" "$HOST:/opt/pm-assistant/deploy/"

ssh -i "$KEY" -o IdentitiesOnly=yes -o ServerAliveInterval=30 \
  "$HOST" 'chmod +x /opt/pm-assistant/deploy/*.sh'

if [ -f "$CHANGELOG" ]; then
  rsync -az \
    -e "$RSH" \
    "$CHANGELOG" "$HOST:/opt/pm-assistant/CHANGELOG.md"
  echo "[sync] CHANGELOG.md → $HOST:/opt/pm-assistant/CHANGELOG.md"
fi
echo "[sync] готово"
