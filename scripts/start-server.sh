#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "${ROOT_DIR}/scripts/lib/cli.sh"

cli_require_env SQLITE_DB_PATH
mkdir -p "$(dirname "${SQLITE_DB_PATH}")"
cli_banner "Colossal Claw server" "Listening on port ${PORT:-3000}"
cli_kv "database" "${SQLITE_DB_PATH}"
exec node server.js
