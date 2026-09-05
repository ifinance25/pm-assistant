#!/usr/bin/env bash
# Предполёт: на проде нет running-заданий и живого Zoom-бота.
# С Mac или на EC2. Код 0 = можно sync/restart, 2 = занято.
set -euo pipefail

KEY="${PM_ASSISTANT_SSH_KEY:-/Users/ifinance/Documents/AI2026/AWS Server/TEST Key.pem}"
HOST="${PM_ASSISTANT_HOST:-ubuntu@16.171.52.89}"
DB_PATH="${PM_ASSISTANT_DB_PATH:-/var/lib/pm-assistant/app.sqlite}"

CHECK=$(cat <<'REMOTE'
set -euo pipefail
DB_PATH="${PM_ASSISTANT_DB_PATH:-/var/lib/pm-assistant/app.sqlite}"
busy=0
echo "=== задания running ==="
if [ ! -f "$DB_PATH" ]; then
  echo "нет базы $DB_PATH" >&2
  exit 1
fi
running=$(sqlite3 "$DB_PATH" "SELECT count(*) FROM jobs WHERE status = 'running';")
if [ "$running" != "0" ]; then
  busy=1
  sqlite3 -header -column "$DB_PATH" \
    "SELECT type, status, meeting_id, substr(coalesce(claimed_at,''), 1, 19) AS claimed_at
     FROM jobs WHERE status = 'running' ORDER BY type;"
else
  echo "(пусто)"
fi
echo
echo "=== встречи joining / waiting_room / recording ==="
live=$(sqlite3 "$DB_PATH" \
  "SELECT count(*) FROM meetings WHERE status IN ('joining','waiting_room','recording');")
if [ "$live" != "0" ]; then
  busy=1
  sqlite3 -header -column "$DB_PATH" \
    "SELECT substr(id,1,8) AS id, status, substr(coalesce(url,''), 1, 48) AS url
     FROM meetings
     WHERE status IN ('joining','waiting_room','recording')
     ORDER BY status;"
else
  echo "(пусто)"
fi
echo
echo "=== docker zoom-bot ==="
if command -v docker >/dev/null 2>&1; then
  bots=$(docker ps -q --filter label=pm-assistant.role=zoom-bot | wc -l | tr -d ' ')
  if [ "$bots" != "0" ]; then
    busy=1
    docker ps --filter label=pm-assistant.role=zoom-bot --format 'table {{.ID}}\t{{.Status}}\t{{.Names}}'
  else
    echo "(нет контейнеров)"
  fi
else
  echo "docker не найден (пропуск)"
fi
echo
echo "=== очередь pending (перезапуск их не рвёт) ==="
sqlite3 -header -column "$DB_PATH" \
  "SELECT type, count(*) AS n FROM jobs WHERE status = 'pending' GROUP BY type;" \
  || true
if [ "$busy" -ne 0 ]; then
  echo
  echo "preflight: занято, restart воркера оборвёт running / живой звонок"
  exit 2
fi
echo
echo "preflight: воркер свободен"
exit 0
REMOTE
)

if [ "${FORCE_DEPLOY:-}" = "1" ]; then
  echo "preflight: FORCE_DEPLOY=1, проверку пропускаем" >&2
  exit 0
fi

if [ -f "$DB_PATH" ]; then
  bash -s <<<"$CHECK"
  exit $?
fi

if [ ! -f "$KEY" ]; then
  echo "нет SSH-ключа: $KEY" >&2
  exit 1
fi

ssh -i "$KEY" -o IdentitiesOnly=yes -o ServerAliveInterval=30 \
  "$HOST" "bash -s" <<<"$CHECK"
