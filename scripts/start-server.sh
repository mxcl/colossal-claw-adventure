#!/usr/bin/env bash
set -euo pipefail

mkdir -p "$(dirname "${SQLITE_DB_PATH}")"
exec node server.js
