#!/usr/bin/env bash
set -euo pipefail

mkdir -p "$(dirname "${SQLITE_DB_PATH:-/data/colossal-claw-adventure.sqlite}")"
exec node server.js
