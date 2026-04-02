#!/usr/bin/env bash
set -euo pipefail
VERSION="0.12.6"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/static/libs/ffmpeg"
mkdir -p "$OUT"
URL="https://unpkg.com/@ffmpeg/core@${VERSION}/dist/esm/ffmpeg-core.wasm"
echo "Downloading $URL -> $OUT/ffmpeg-core.wasm"
curl -fsSL "$URL" -o "$OUT/ffmpeg-core.wasm"
ls -la "$OUT/ffmpeg-core.wasm"
