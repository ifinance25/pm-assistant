#!/usr/bin/env bash
# Сборка whisper.cpp с разделяемыми библиотеками (.so) и обёрткой CLI.
# Идемпотентно. Секреты не печатает. Запускать на EC2 с sudo.
set -euo pipefail

CLI=/usr/local/bin/whisper-cli
WRAP=/usr/local/bin/whisper
LIBDIR=/usr/local/lib
MODEL=/var/lib/pm-assistant/models/ggml-small.bin
COMPAT="$(cd "$(dirname "$0")" && pwd)/whisper-compat.py"

log() { echo "[install-whisper] $*"; }

if [ "$(id -u)" -ne 0 ]; then
  exec sudo -E bash "$0" "$@"
fi

export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export DEBIAN_FRONTEND=noninteractive

apt-get update -qq
apt-get install -y -qq build-essential cmake git ffmpeg curl ca-certificates >/dev/null

mkdir -p "$LIBDIR" /usr/local/bin /var/lib/pm-assistant/models
printf '%s\n' "$LIBDIR" > /etc/ld.so.conf.d/pm-whisper.conf

build=$(mktemp -d /tmp/whisper-cpp.XXXXXX)
cleanup() { rm -rf "$build"; }
trap cleanup EXIT

log "клон whisper.cpp"
git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git "$build/whisper.cpp"

log "cmake (CPU, shared libs)"
cmake -S "$build/whisper.cpp" -B "$build/whisper.cpp/build" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_INSTALL_PREFIX=/usr/local \
  -DBUILD_SHARED_LIBS=ON \
  -DGGML_NATIVE=OFF \
  -DGGML_CUDA=OFF \
  -DWHISPER_BUILD_TESTS=OFF
cmake --build "$build/whisper.cpp/build" -j2 --config Release
cmake --install "$build/whisper.cpp/build" || true

if [ -x "$build/whisper.cpp/build/bin/whisper-cli" ]; then
  install -m 755 "$build/whisper.cpp/build/bin/whisper-cli" "$CLI"
fi

log "копирую libwhisper / libggml в $LIBDIR"
while IFS= read -r -d '' so; do
  install -m 755 "$so" "$LIBDIR/"
done < <(find "$build/whisper.cpp/build" -type f \( \
  -name 'libwhisper.so*' -o -name 'libggml*.so*' \
\) -print0)

if [ ! -x "$CLI" ]; then
  echo "нет $CLI после сборки" >&2
  exit 1
fi

ldconfig
export LD_LIBRARY_PATH="$LIBDIR${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

if ldd "$CLI" | grep -q 'not found'; then
  echo "ldd $CLI: не хватает библиотек" >&2
  ldd "$CLI" || true
  exit 1
fi
log "ldd whisper-cli ок"

if [ ! -f "$COMPAT" ]; then
  echo "нет $COMPAT" >&2
  exit 1
fi
install -m 755 "$COMPAT" "$WRAP"

if [ ! -f "$MODEL" ]; then
  log "скачиваю ggml-small.bin"
  curl -fsSL "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin" \
    -o "$MODEL"
fi
chmod 644 "$MODEL"
chown ubuntu:ubuntu "$MODEL" 2>/dev/null || true

log "проверка бинаря"
"$CLI" -h >/dev/null 2>&1 || true
log "готово: $CLI + $WRAP + модель"
