#!/usr/bin/env bash
# Диагностика PM Assistant на EC2. Секреты и значения env не печатает.
set -euo pipefail

DB=/var/lib/pm-assistant/app.sqlite
CLI=/usr/local/bin/whisper-cli
WRAP=/usr/local/bin/whisper
MODEL=/var/lib/pm-assistant/models/ggml-small.bin
export LD_LIBRARY_PATH=/usr/local/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}

ok=0
fail() { echo "FAIL: $*"; ok=1; }
pass() { echo "OK: $*"; }

echo "=== systemd (только pm-assistant) ==="
for u in pm-assistant-api.service pm-assistant-worker.service; do
  st=$(systemctl is-active "$u" 2>/dev/null || true)
  if [ "$st" = active ]; then
    pass "$u active"
  else
    fail "$u is-active=$st"
  fi
done

echo
echo "=== whisper-cli ldd ==="
if [ ! -x "$CLI" ]; then
  fail "нет $CLI"
else
  pass "$CLI существует"
  if ldd "$CLI" | grep -q 'not found'; then
    fail "ldd: есть not found"
    ldd "$CLI" | grep 'not found' || true
  else
    pass "ldd без not found"
  fi
fi
if [ -x "$WRAP" ]; then
  pass "$WRAP существует"
else
  fail "нет $WRAP"
fi
if [ -f "$MODEL" ]; then
  pass "модель $(du -h "$MODEL" | awk '{print $1}')"
else
  fail "нет модели $MODEL"
fi

echo
echo "=== docker image ==="
if command -v docker >/dev/null 2>&1; then
  if docker image inspect pm-assistant-zoom-bot >/dev/null 2>&1; then
    created=$(docker image inspect pm-assistant-zoom-bot --format '{{.Created}}' 2>/dev/null || true)
    pass "pm-assistant-zoom-bot created=$created"
  else
    fail "нет образа pm-assistant-zoom-bot"
  fi
else
  fail "docker не найден"
fi

echo
echo "=== sqlite встречи / сегменты ==="
if [ ! -f "$DB" ]; then
  fail "нет $DB"
else
  pass "бд $DB"
  sqlite3 "$DB" <<'SQL'
.headers on
.mode column
SELECT id, status, source,
  CASE WHEN audio_path IS NULL OR audio_path = '' THEN 0 ELSE 1 END AS has_audio,
  substr(coalesce(error, ''), 1, 80) AS err
FROM meetings
ORDER BY rowid DESC
LIMIT 5;
SELECT meeting_id, speaker, started_at_ms, substr(text, 1, 90) AS text
FROM transcript_segments
ORDER BY rowid DESC
LIMIT 8;
SQL
fi

echo
if [ "$ok" -eq 0 ]; then
  echo "doctor: всё ок"
else
  echo "doctor: есть ошибки"
fi
exit "$ok"
