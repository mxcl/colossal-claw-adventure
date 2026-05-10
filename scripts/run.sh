#!/bin/sh

export PORT=$(env -u FORCE_COLOR -u CLICOLOR_FORCE npx --yes get-port-cli 3000)
export BASE_URL="http://localhost:$PORT"

if [ -t 1 ]; then
	node --watch --watch-preserve-output server.js &
	pid=$!
	open "$BASE_URL"
	wait "$pid"
else
	exec node --watch --watch-preserve-output server.js
fi
