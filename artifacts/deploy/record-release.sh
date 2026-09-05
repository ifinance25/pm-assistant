#!/usr/bin/env bash
# Дописывает CHANGELOG.md для версии из app/package.json. Запускать с Mac.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
exec node "$HERE/record-release.mjs" "$@"
