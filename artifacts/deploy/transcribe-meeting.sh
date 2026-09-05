#!/usr/bin/env bash
# Расшифровка сохранённого wav через CLI. Запускать на EC2.
# Останавливает воркер на время прогона, чтобы не делить SQLite.
set -euo pipefail

MEETING_ID="${1:-}"
if [ -z "$MEETING_ID" ]; then
  echo "usage: bash transcribe-meeting.sh <meeting-id>" >&2
  exit 1
fi

APP=/opt/pm-assistant/app
export PATH=/opt/node-24/bin:/usr/local/bin:/usr/bin:/bin
export LD_LIBRARY_PATH=/usr/local/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}
export WHISPER_BIN=/usr/local/bin/whisper
export WHISPER_CLI=/usr/local/bin/whisper-cli
export WHISPER_MODEL="${WHISPER_MODEL:-/var/lib/pm-assistant/models/ggml-small.bin}"
export PM_ASSISTANT_DB_PATH="${PM_ASSISTANT_DB_PATH:-/var/lib/pm-assistant/app.sqlite}"

echo "[transcribe] stop worker, встреча=$MEETING_ID"
sudo systemctl stop pm-assistant-worker.service

restart_worker() {
  sudo systemctl start pm-assistant-worker.service
}
trap restart_worker EXIT

cd "$APP"
node src/worker/transcribe-cli.ts "$MEETING_ID"
echo "[transcribe] CLI завершился, воркер поднимется через trap"
