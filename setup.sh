#!/usr/bin/env bash
# One-command setup for Holographic Studio.
#   ./setup.sh
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed."
  echo "Install Node 22 LTS from https://nodejs.org (or run: brew install node@22), then run ./setup.sh again."
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "Holographic Studio needs Node.js 22 or newer (found $(node -v))."
  echo "Install Node 22 LTS from https://nodejs.org, then run ./setup.sh again."
  exit 1
fi

echo "Installing dependencies (this downloads Electron and FFmpeg, so it can take a few minutes)..."
npm install

echo
node scripts/doctor.mjs
