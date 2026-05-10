#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "${ROOT_DIR}/scripts/lib/cli.sh"

PORT=$(env -u FORCE_COLOR -u CLICOLOR_FORCE npx --yes get-port-cli 3000)
export PORT
export BASE_URL="http://localhost:$PORT"

cli_banner "Colossal Claw dev server" "${BASE_URL}"

if [[ -t 1 ]]; then
	cli_step "Starting node --watch"
	node --watch --watch-preserve-output server.js &
	pid=$!
	cli_ok "Opening ${BASE_URL}"
	open "$BASE_URL"
	wait "$pid"
else
	exec node --watch --watch-preserve-output server.js
fi
