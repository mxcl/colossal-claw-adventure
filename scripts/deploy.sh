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
APP_PORT="${APP_PORT:-3000}"
PUBLIC_HOSTNAME="${PUBLIC_HOSTNAME:-}"
BASE_URL="${BASE_URL:-}"
APP_NODE_ENV="${APP_NODE_ENV:-}"
if [[ -z "${BASE_URL}" && -n "${PUBLIC_HOSTNAME}" ]]; then
  BASE_URL="http://${PUBLIC_HOSTNAME}"
fi

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
  APP_PORT            App listen port behind nginx
  PUBLIC_HOSTNAME     Domain to serve with nginx on port 80
  BASE_URL            Canonical base URL exposed to the app
  APP_NODE_ENV        Optional NODE_ENV value written to the app env file
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

ssh -p "${DEPLOY_PORT}" "${REMOTE}" "
APP_USER=\$(id -un)
APP_GROUP=\$(id -gn)
if command -v sudo >/dev/null 2>&1; then
  sudo mkdir -p '${REMOTE_APP_DIR}' '${REMOTE_DATA_DIR}'
  sudo chown -R \"\${APP_USER}:\${APP_GROUP}\" \
    '${REMOTE_APP_DIR}' '${REMOTE_DATA_DIR}'
else
  mkdir -p '${REMOTE_APP_DIR}' '${REMOTE_DATA_DIR}'
  chown -R \"\${APP_USER}:\${APP_GROUP}\" \
    '${REMOTE_APP_DIR}' '${REMOTE_DATA_DIR}'
fi
"

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
APP_PORT='${APP_PORT}'
PUBLIC_HOSTNAME='${PUBLIC_HOSTNAME}'
BASE_URL='${BASE_URL}'
APP_NODE_ENV='${APP_NODE_ENV}'
APP_USER="\$(id -un)"
APP_GROUP="\$(id -gn)"
SUDO=""

if command -v sudo >/dev/null 2>&1; then
  SUDO="sudo"
fi

ensure_cmd() {
  if command -v "\$1" >/dev/null 2>&1; then
    return
  fi

  if command -v dnf >/dev/null 2>&1; then
    \$SUDO dnf install -y "\$2"
    return
  fi

  if command -v apt-get >/dev/null 2>&1; then
    \$SUDO apt-get update -y
    \$SUDO apt-get install -y "\$3"
    return
  fi

  echo "Unable to install required package for \$1" >&2
  exit 1
}

ensure_node_runtime() {
  local node_major=0

  if command -v node >/dev/null 2>&1; then
    node_major="\$(node --version | sed 's/^v//; s/\..*//')"
  fi

  if [[ "\${node_major}" -ge 22 ]]; then
    return
  fi

  if command -v dnf >/dev/null 2>&1; then
    \$SUDO dnf install -y nodejs22 nodejs22-npm --allowerasing

    if command -v alternatives >/dev/null 2>&1; then
      [[ -x /usr/bin/node-22 ]] && \
        \$SUDO alternatives --set node /usr/bin/node-22 || true
      [[ -x /usr/bin/npm-22 ]] && \
        \$SUDO alternatives --set npm /usr/bin/npm-22 || true
    fi

    return
  fi

  ensure_cmd node nodejs nodejs
  ensure_cmd npm nodejs npm
}

ensure_swap() {
  if swapon --show | grep -q '/swapfile'; then
    return
  fi

  if [[ ! -f /swapfile ]]; then
    \$SUDO fallocate -l 1G /swapfile || \$SUDO dd if=/dev/zero \
      of=/swapfile bs=1M count=1024
    \$SUDO chmod 600 /swapfile
    \$SUDO mkswap /swapfile
  fi

  \$SUDO swapon /swapfile
  if ! grep -q '^/swapfile ' /etc/fstab; then
    echo '/swapfile swap swap defaults 0 0' | \
      \$SUDO tee -a /etc/fstab >/dev/null
  fi
}

upsert_env() {
  local key="\$1"
  local value="\$2"
  local escaped_value
  escaped_value=\$(printf '%s' "\$value" | sed 's/[&/]/\\\\&/g')

  if \$SUDO grep -q "^\${key}=" "\$ENV_FILE"; then
    \$SUDO sed -i "s/^\${key}=.*/\${key}=\${escaped_value}/" "\$ENV_FILE"
  else
    printf '%s=%s\n' "\$key" "\$value" | \$SUDO tee -a "\$ENV_FILE" >/dev/null
  fi
}

write_nginx_config() {
  local nginx_conf="/etc/nginx/conf.d/\${SERVICE_NAME}.conf"

  if [[ -z "\$PUBLIC_HOSTNAME" ]]; then
    return
  fi

  if [[ -f "\$nginx_conf" ]] && \
    \$SUDO grep -q 'managed by Certbot' "\$nginx_conf"; then
    return
  fi

  cat <<'NGINX' | \
    sed \
      -e "s/__PUBLIC_HOSTNAME__/\${PUBLIC_HOSTNAME}/g" \
      -e "s/__APP_PORT__/\${APP_PORT}/g" | \
    \$SUDO tee "\$nginx_conf" >/dev/null
server {
  listen 80;
  listen [::]:80;
  server_name __PUBLIC_HOSTNAME__ www.__PUBLIC_HOSTNAME__;

  location / {
    proxy_pass http://127.0.0.1:__APP_PORT__;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
}
NGINX

  if [[ -f /etc/nginx/nginx.conf ]]; then
    \$SUDO rm -f /etc/nginx/conf.d/default.conf
    \$SUDO systemctl enable nginx >/dev/null
    \$SUDO systemctl restart nginx
  fi
}

ensure_cmd rsync rsync rsync
ensure_node_runtime
ensure_cmd nginx nginx nginx
ensure_cmd make make make
ensure_cmd python3 python3 python3
ensure_cmd g++ gcc-c++ g++
ensure_swap

\$SUDO mkdir -p "\$APP_DIR" "\$DATA_DIR"
\$SUDO chown -R "\$APP_USER:\$APP_GROUP" "\$APP_DIR" "\$DATA_DIR"

if [[ ! -f "\$ENV_FILE" ]]; then
  \$SUDO install -m 0600 /dev/null "\$ENV_FILE"
fi

upsert_env SQLITE_DB_PATH "\$APP_DB_PATH"
upsert_env PORT "\$APP_PORT"

if [[ -n "\$BASE_URL" ]]; then
  upsert_env BASE_URL "\$BASE_URL"
fi

if [[ -n "\$APP_NODE_ENV" ]]; then
  upsert_env NODE_ENV "\$APP_NODE_ENV"
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

write_nginx_config

cd "\$APP_DIR"
npm ci --omit=dev

\$SUDO systemctl daemon-reload
\$SUDO systemctl enable "\$SERVICE_NAME" >/dev/null
\$SUDO systemctl restart "\$SERVICE_NAME"
\$SUDO systemctl --no-pager --full status "\$SERVICE_NAME" | sed -n '1,12p'
EOF
)

printf '%s\n' "${remote_script}" | ssh -p "${DEPLOY_PORT}" "${REMOTE}" 'bash -s'
