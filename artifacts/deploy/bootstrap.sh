#!/usr/bin/env bash
# Идемпотентная установка PM Assistant на Ubuntu EC2.
# Секреты не печатает. Запускать на сервере от ubuntu с sudo.
set -euo pipefail

export PATH=/opt/node-24/bin:/usr/local/bin:/usr/bin:/bin
NODE_ROOT=/opt/node-24
APP_ROOT=/opt/pm-assistant/app
DATA_ROOT=/var/lib/pm-assistant

log() { echo "[pm-assistant] $*"; }

if [ ! -f /swapfile ]; then
  log "swap 2G"
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
else
  sudo swapon /swapfile 2>/dev/null || true
  log "swap уже есть"
fi

log "пакеты"
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  build-essential python3 cmake git ffmpeg curl ca-certificates \
  sqlite3 >/dev/null

if ! command -v docker >/dev/null 2>&1; then
  log "Docker Engine (docker.io)"
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker.io >/dev/null
fi
sudo systemctl enable --now docker
sudo usermod -aG docker ubuntu
sudo ln -sfn "$(command -v docker)" /usr/local/bin/docker

if [ ! -x "$NODE_ROOT/bin/node" ]; then
  log "Node 24 в $NODE_ROOT (системный /usr/bin/node не трогаем)"
  tmp=$(mktemp -d)
  ver_html=$(curl -fsSL https://nodejs.org/dist/latest-v24.x/)
  tarball=$(printf '%s' "$ver_html" | grep -oE 'node-v24\.[0-9]+\.[0-9]+-linux-x64.tar.xz' | head -1)
  if [ -z "$tarball" ]; then
    echo "не удалось найти tarball Node 24" >&2
    exit 1
  fi
  log "скачиваю $tarball"
  curl -fsSL "https://nodejs.org/dist/latest-v24.x/$tarball" -o "$tmp/node.tar.xz"
  sudo mkdir -p "$NODE_ROOT"
  sudo tar -xJf "$tmp/node.tar.xz" -C "$NODE_ROOT" --strip-components=1
  rm -rf "$tmp"
fi
"$NODE_ROOT/bin/node" -v

sudo mkdir -p "$APP_ROOT" "$DATA_ROOT/models" "$DATA_ROOT/audio" \
  /opt/pm-assistant/app/data/audio
sudo chown -R ubuntu:ubuntu /opt/pm-assistant "$DATA_ROOT"

log "npm install + better-sqlite3 + vite build"
cd "$APP_ROOT"
"$NODE_ROOT/bin/npm" install
if [ -d node_modules/better-sqlite3 ]; then
  (cd node_modules/better-sqlite3 && "$NODE_ROOT/bin/npx" --yes node-gyp rebuild --release)
fi
"$NODE_ROOT/bin/npm" run build
# prune пропускаем: на 2 ГБ RAM npm prune зависает

log "Docker-образ Zoom-бота"
cd "$APP_ROOT/bot/zoom-web"
sudo docker build -t pm-assistant-zoom-bot .

log "whisper.cpp + библиотеки + обёртка"
sudo bash /opt/pm-assistant/deploy/install-whisper.sh

sudo cp /opt/pm-assistant/deploy/pm-assistant-api.service /etc/systemd/system/
sudo cp /opt/pm-assistant/deploy/pm-assistant-worker.service /etc/systemd/system/
sudo cp /opt/pm-assistant/deploy/nginx-pm-assistant.conf /etc/nginx/sites-available/pm-assistant
sudo ln -sfn /etc/nginx/sites-available/pm-assistant /etc/nginx/sites-enabled/pm-assistant
sudo nginx -t
sudo systemctl reload nginx

sudo systemctl daemon-reload
sudo systemctl enable --now pm-assistant-api.service pm-assistant-worker.service
sleep 2
sudo systemctl is-active pm-assistant-api.service pm-assistant-worker.service docker.service nginx.service

log "health"
curl -fsS http://127.0.0.1:8787/api/health || true
echo
curl -fsS -o /dev/null -w "ui:%{http_code}\n" http://127.0.0.1:5173/ || true
curl -fsS -X PUT http://127.0.0.1:8787/api/settings \
  -H 'content-type: application/json' \
  -d '{"recordingModeDefault":"local_audio"}' >/dev/null
curl -fsS http://127.0.0.1:8787/api/settings | python3 -c 'import json,sys; d=json.load(sys.stdin); print("recordingModeDefault="+d.get("recordingModeDefault",""))'

log "готово"
