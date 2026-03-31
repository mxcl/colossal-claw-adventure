#!/usr/bin/env bash
set -euo pipefail

APP_NAME="colossal-claw-adventure"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PRODUCTION_ENV_FILE="${ROOT_DIR}/.env.production"

if [[ -f "${PRODUCTION_ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${PRODUCTION_ENV_FILE}"
  set +a
fi

REMOTE="${1:-${DEPLOY_HOST:-}}"
DEPLOY_PORT="${DEPLOY_PORT:-22}"
SSH_IDENTITY_FILE="${SSH_IDENTITY_FILE:-}"
SSH_EXTRA_OPTS="${SSH_EXTRA_OPTS:-}"
REMOTE_APP_DIR="${REMOTE_APP_DIR:-/opt/${APP_NAME}}"
REMOTE_DATA_DIR="${REMOTE_DATA_DIR:-/var/lib/${APP_NAME}}"
REMOTE_ENV_FILE="${REMOTE_ENV_FILE:-/etc/${APP_NAME}.env}"
REMOTE_SERVICE="${REMOTE_SERVICE:-${APP_NAME}}"
APP_PORT="${APP_PORT:-3000}"
PUBLIC_HOSTNAME="${PUBLIC_HOSTNAME:-}"
BASE_URL="${BASE_URL:-}"
APP_NODE_ENV="${APP_NODE_ENV:-}"
REVERSE_PROXY="${REVERSE_PROXY:-auto}"
if [[ -z "${BASE_URL}" && -n "${PUBLIC_HOSTNAME}" ]]; then
  BASE_URL="https://${PUBLIC_HOSTNAME}"
fi

usage() {
  cat <<EOF
Usage: scripts/deploy.sh [user@host]

Environment overrides:
  .env.production    Auto-loaded if present from repo root
  DEPLOY_HOST         Default SSH target if no positional host is given
  DEPLOY_PORT         SSH port
  SSH_IDENTITY_FILE   SSH private key to use for ssh/rsync
  SSH_EXTRA_OPTS      Additional ssh options (for example,
                      '-o StrictHostKeyChecking=accept-new')
  REMOTE_APP_DIR      Remote app directory
  REMOTE_DATA_DIR     Remote data directory
  REMOTE_ENV_FILE     Remote environment file
  REMOTE_SERVICE      Remote systemd service name
  APP_PORT            App listen port behind the reverse proxy
  PUBLIC_HOSTNAME     Domain served by the reverse proxy
  BASE_URL            Canonical base URL exposed to the app
  APP_NODE_ENV        Optional NODE_ENV value written to the app env file
  REVERSE_PROXY       auto (default), nginx, or caddy
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

ssh_args=(-p "${DEPLOY_PORT}")

if [[ -n "${SSH_IDENTITY_FILE}" ]]; then
  ssh_args+=(-i "${SSH_IDENTITY_FILE}")
fi

if [[ -n "${SSH_EXTRA_OPTS}" ]]; then
  # shellcheck disable=SC2206
  extra_ssh_args=(${SSH_EXTRA_OPTS})
  ssh_args+=("${extra_ssh_args[@]}")
fi

printf -v rsync_ssh_cmd '%q ' ssh "${ssh_args[@]}"
rsync_ssh_cmd="${rsync_ssh_cmd% }"

ssh "${ssh_args[@]}" "${REMOTE}" "
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
  -e "${rsync_ssh_cmd}" \
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
REVERSE_PROXY='${REVERSE_PROXY}'
EXPECTED_HEAD_MARKER='<meta property="og:site_name" content="Colossal Claw Adventure">'
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

write_caddy_config() {
  local caddy_conf="/etc/caddy/Caddyfile"

  if [[ -z "\$PUBLIC_HOSTNAME" ]]; then
    return
  fi

  cat <<'CADDY' | \
    sed \
      -e "s/__PUBLIC_HOSTNAME__/\${PUBLIC_HOSTNAME}/g" \
      -e "s/__APP_PORT__/\${APP_PORT}/g" | \
    \$SUDO tee "\$caddy_conf" >/dev/null
{
    storage file_system /var/lib/caddy
}

__PUBLIC_HOSTNAME__, www.__PUBLIC_HOSTNAME__ {
    encode zstd gzip
    reverse_proxy 127.0.0.1:__APP_PORT__
}
CADDY

  \$SUDO systemctl disable --now nginx >/dev/null 2>&1 || true
  \$SUDO systemctl enable caddy >/dev/null
  \$SUDO systemctl restart caddy
}

configure_reverse_proxy() {
  local proxy_mode="\$REVERSE_PROXY"

  if [[ -z "\$PUBLIC_HOSTNAME" ]]; then
    return
  fi

  if [[ "\$proxy_mode" == "auto" ]]; then
    if command -v caddy >/dev/null 2>&1 || \
      \$SUDO test -x /usr/local/bin/caddy || \
      \$SUDO test -x /usr/bin/caddy; then
      proxy_mode="caddy"
    else
      proxy_mode="nginx"
    fi
  fi

  case "\$proxy_mode" in
    caddy)
      ensure_cmd caddy caddy caddy
      write_caddy_config
      ;;
    nginx)
      ensure_cmd nginx nginx nginx
      \$SUDO systemctl disable --now caddy >/dev/null 2>&1 || true
      write_nginx_config
      ;;
    *)
      echo "Unsupported reverse proxy: \$proxy_mode" >&2
      exit 1
      ;;
  esac
}

ensure_cmd rsync rsync rsync
ensure_cmd curl curl curl
ensure_node_runtime
ensure_cmd make make make
ensure_cmd python3 python3 python3
ensure_cmd g++ gcc-c++ g++
ensure_swap

verify_unit_file() {
  local unit_path="/etc/systemd/system/\${SERVICE_NAME}.service"

  if ! \$SUDO test -f "\$unit_path"; then
    echo "Missing systemd unit: \$unit_path" >&2
    exit 1
  fi

  if ! \$SUDO grep -Fx "WorkingDirectory=\$APP_DIR" "\$unit_path" >/dev/null; then
    echo "systemd unit is not pointing at \$APP_DIR" >&2
    exit 1
  fi

  if ! \$SUDO grep -Fx "ExecStart=\$APP_DIR/scripts/start-server.sh" \
    "\$unit_path" >/dev/null; then
    echo "systemd unit is not starting \$APP_DIR/scripts/start-server.sh" >&2
    exit 1
  fi
}

wait_for_service() {
  local main_pid=""
  local attempt=0

  for attempt in {1..30}; do
    main_pid=\$(\$SUDO systemctl show -p MainPID --value "\$SERVICE_NAME")

    if [[ -n "\$main_pid" && "\$main_pid" != "0" ]]; then
      printf '%s\n' "\$main_pid"
      return
    fi

    sleep 1
  done

  echo "Timed out waiting for \$SERVICE_NAME to start" >&2
  exit 1
}

find_listener_pid() {
  \$SUDO ss -ltnp "( sport = :\${APP_PORT} )" 2>/dev/null | \
    grep -o 'pid=[0-9]\+' | head -n 1 | cut -d= -f2
}

clear_conflicting_listener() {
  local listener_pid=""
  local service_pid=""
  local process_cwd=""
  local process_cmdline=""
  local attempt=0

  listener_pid="\$(find_listener_pid || true)"

  if [[ -z "\$listener_pid" ]]; then
    return
  fi

  service_pid=\$(\$SUDO systemctl show -p MainPID --value "\$SERVICE_NAME" || true)

  if [[ -n "\$service_pid" && "\$listener_pid" == "\$service_pid" ]]; then
    return
  fi

  process_cwd=\$(\$SUDO readlink "/proc/\${listener_pid}/cwd" 2>/dev/null || true)
  process_cmdline=\$(\$SUDO tr '\0' ' ' <"/proc/\${listener_pid}/cmdline" 2>/dev/null || true)

  if [[ "\$process_cwd" != "\$APP_DIR" ]]; then
    echo "Port \$APP_PORT is occupied by unrelated process \$listener_pid" >&2
    echo "cwd: \$process_cwd" >&2
    echo "cmd: \$process_cmdline" >&2
    exit 1
  fi

  echo "Stopping stale app listener pid \$listener_pid on port \$APP_PORT" >&2
  \$SUDO kill "\$listener_pid" || true

  for attempt in {1..10}; do
    if ! \$SUDO kill -0 "\$listener_pid" 2>/dev/null; then
      return
    fi

    sleep 1
  done

  echo "Force killing stale app listener pid \$listener_pid" >&2
  \$SUDO kill -9 "\$listener_pid"

  for attempt in {1..10}; do
    if ! \$SUDO kill -0 "\$listener_pid" 2>/dev/null; then
      return
    fi

    sleep 1
  done

  echo "Failed to remove stale app listener pid \$listener_pid" >&2
  exit 1
}

verify_service_process() {
  local main_pid="\$1"
  local process_cwd

  process_cwd=\$(\$SUDO readlink "/proc/\${main_pid}/cwd")

  if [[ "\$process_cwd" != "\$APP_DIR" ]]; then
    echo "Service main process cwd was \$process_cwd, expected \$APP_DIR" >&2
    exit 1
  fi
}

verify_http_response() {
  local response_file
  local attempt=0

  response_file=\$(mktemp)

  for attempt in {1..30}; do
    if curl -fsS "http://127.0.0.1:\${APP_PORT}/" >"\$response_file"; then
      if grep -Fq "\$EXPECTED_HEAD_MARKER" "\$response_file"; then
        rm -f "\$response_file"
        return
      fi
    fi

    sleep 1
  done

  echo "App did not serve expected Open Graph markup after restart" >&2
  sed -n '1,40p' "\$response_file" >&2 || true
  rm -f "\$response_file"
  exit 1
}

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
KillMode=control-group
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICE

configure_reverse_proxy

cd "\$APP_DIR"
npm ci --omit=dev

\$SUDO systemctl daemon-reload
\$SUDO systemctl reset-failed "\$SERVICE_NAME" || true
\$SUDO systemctl enable "\$SERVICE_NAME" >/dev/null
verify_unit_file
\$SUDO systemctl stop "\$SERVICE_NAME" || true
clear_conflicting_listener
\$SUDO systemctl start "\$SERVICE_NAME"
main_pid="\$(wait_for_service)"
verify_service_process "\$main_pid"
verify_http_response
\$SUDO systemctl --no-pager --full status "\$SERVICE_NAME" | sed -n '1,12p'
EOF
)

printf '%s\n' "${remote_script}" | ssh "${ssh_args[@]}" "${REMOTE}" 'bash -s'
