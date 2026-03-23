#!/usr/bin/env bash
set -euo pipefail

APP_NAME="colossal-claw-adventure"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE="${1:-${DEPLOY_HOST:-}}"
DEPLOY_PORT="${DEPLOY_PORT:-22}"
REMOTE_APP_DIR="${REMOTE_APP_DIR:-/opt/${APP_NAME}}"
REMOTE_DATA_DIR="${REMOTE_DATA_DIR:-/var/lib/${APP_NAME}}"
REMOTE_ENV_FILE="${REMOTE_ENV_FILE:-/etc/${APP_NAME}.env}"
REMOTE_SERVICE="${REMOTE_SERVICE:-${APP_NAME}}"

usage() {
  cat <<EOF
Usage: scripts/deploy.sh [user@host]

Environment overrides:
  DEPLOY_HOST         Default SSH target if no positional host is given
  DEPLOY_PORT         SSH port
  REMOTE_APP_DIR      Remote app directory
  REMOTE_DATA_DIR     Remote data directory
  REMOTE_ENV_FILE     Remote environment file
  REMOTE_SERVICE      Remote systemd service name
EOF
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

if [[ -z "${REMOTE}" ]]; then
  usage >&2
  exit 1
fi

require_cmd ssh
require_cmd rsync

ssh -p "${DEPLOY_PORT}" "${REMOTE}" \
  "mkdir -p '${REMOTE_APP_DIR}' '${REMOTE_DATA_DIR}'"

rsync -az --delete \
  --exclude ".git/" \
  --exclude "node_modules/" \
  --exclude "data/" \
  --exclude ".env*" \
  -e "ssh -p ${DEPLOY_PORT}" \
  "${ROOT_DIR}/" "${REMOTE}:${REMOTE_APP_DIR}/"

remote_script=$(cat <<EOF
set -euo pipefail

APP_DIR='${REMOTE_APP_DIR}'
DATA_DIR='${REMOTE_DATA_DIR}'
ENV_FILE='${REMOTE_ENV_FILE}'
SERVICE_NAME='${REMOTE_SERVICE}'
APP_DB_PATH='${REMOTE_DATA_DIR}/${APP_NAME}.sqlite'
APP_USER="\$(id -un)"
APP_GROUP="\$(id -gn)"
SUDO=""

if command -v sudo >/dev/null 2>&1; then
  SUDO="sudo"
fi

\$SUDO mkdir -p "\$APP_DIR" "\$DATA_DIR"
\$SUDO chown -R "\$APP_USER:\$APP_GROUP" "\$APP_DIR" "\$DATA_DIR"

if [[ ! -f "\$ENV_FILE" ]]; then
  \$SUDO install -m 0600 /dev/null "\$ENV_FILE"
fi

if ! \$SUDO grep -q '^SQLITE_DB_PATH=' "\$ENV_FILE"; then
  printf 'SQLITE_DB_PATH=%s\n' "\$APP_DB_PATH" | \
    \$SUDO tee -a "\$ENV_FILE" >/dev/null
fi

cat <<SERVICE | \$SUDO tee "/etc/systemd/system/\${SERVICE_NAME}.service" >/dev/null
[Unit]
Description=Colossal Claw Adventure
After=network.target

[Service]
Type=simple
User=\$APP_USER
Group=\$APP_GROUP
WorkingDirectory=\$APP_DIR
EnvironmentFile=\$ENV_FILE
ExecStart=\$APP_DIR/scripts/start-server.sh
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICE

cd "\$APP_DIR"
npm ci

\$SUDO systemctl daemon-reload
\$SUDO systemctl enable "\$SERVICE_NAME" >/dev/null
\$SUDO systemctl restart "\$SERVICE_NAME"
\$SUDO systemctl --no-pager --full status "\$SERVICE_NAME" | sed -n '1,12p'
EOF
)

printf '%s\n' "${remote_script}" | ssh -p "${DEPLOY_PORT}" "${REMOTE}" 'bash -s'
