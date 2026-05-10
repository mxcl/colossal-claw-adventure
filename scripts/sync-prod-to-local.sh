#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ACTION="${1:-pull}"
REMOTE="${2:-${DEPLOY_HOST}}"
DEPLOY_PORT="${DEPLOY_PORT:-22}"
LOCAL_DB_PATH="${LOCAL_DB_PATH:-${ROOT_DIR}/data/${APP_NAME}.sqlite}"
REMOTE_TMP_PATH="/tmp/${APP_NAME}.sync.sqlite"

usage() {
  cat <<EOF
Usage: scripts/sync-prod-to-local.sh [pull|push] [user@host]
Run from a direnv-enabled shell so .envrc values are already exported.
EOF
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

case "${ACTION}" in
  pull|push)
    ;;
  *)
    usage >&2
    exit 1
    ;;
esac

require_cmd ssh
require_cmd rsync

SSH_IDENTITY_FILE="${SSH_IDENTITY_FILE/#\~/${HOME}}"
ssh_args=(-p "${DEPLOY_PORT}" -i "${SSH_IDENTITY_FILE}")
if [[ -n "${SSH_EXTRA_OPTS:-}" ]]; then
  # shellcheck disable=SC2206
  extra_ssh_args=(${SSH_EXTRA_OPTS})
  ssh_args+=("${extra_ssh_args[@]}")
fi

printf -v rsync_ssh_cmd '%q ' ssh "${ssh_args[@]}"
rsync_ssh_cmd="${rsync_ssh_cmd% }"

pull_db() {
  mkdir -p "$(dirname "${LOCAL_DB_PATH}")"

  ssh "${ssh_args[@]}" "${REMOTE}" \
    "set -euo pipefail
     sqlite3 '${REMOTE_DB_PATH}' \".backup '${REMOTE_TMP_PATH}'\""

  rsync -az -e "${rsync_ssh_cmd}" \
    "${REMOTE}:${REMOTE_TMP_PATH}" "${LOCAL_DB_PATH}"

  ssh "${ssh_args[@]}" "${REMOTE}" "rm -f '${REMOTE_TMP_PATH}'"
  rm -f "${LOCAL_DB_PATH}-shm" "${LOCAL_DB_PATH}-wal"
  echo "Pulled ${REMOTE_DB_PATH} to ${LOCAL_DB_PATH}"
}

push_db() {
  local local_tmp

  require_cmd sqlite3

  if [[ ! -f "${LOCAL_DB_PATH}" ]]; then
    echo "Local database not found: ${LOCAL_DB_PATH}" >&2
    exit 1
  fi

  local_tmp="$(mktemp "${TMPDIR:-/tmp}/${APP_NAME}.push.XXXXXX.sqlite")"
  trap 'rm -f "${local_tmp}"' EXIT

  sqlite3 "${LOCAL_DB_PATH}" ".backup '${local_tmp}'"

  rsync -az -e "${rsync_ssh_cmd}" \
    "${local_tmp}" "${REMOTE}:${REMOTE_TMP_PATH}"

  ssh "${ssh_args[@]}" "${REMOTE}" "
    set -euo pipefail
    SUDO=''
    if command -v sudo >/dev/null 2>&1; then
      SUDO='sudo'
    fi
    DB_DIR=\$(dirname '${REMOTE_DB_PATH}')
    \$SUDO mkdir -p \"\${DB_DIR}\"
    if systemctl list-unit-files | grep -q '^${REMOTE_SERVICE}\.service'; then
      \$SUDO systemctl stop '${REMOTE_SERVICE}'
    fi
    \$SUDO rm -f '${REMOTE_DB_PATH}-shm' '${REMOTE_DB_PATH}-wal'
    \$SUDO cp '${REMOTE_TMP_PATH}' '${REMOTE_DB_PATH}'
    OWNER=\$(stat -c '%u:%g' \"\${DB_DIR}\" 2>/dev/null || true)
    if [[ -n \"\${OWNER}\" ]]; then
      \$SUDO chown \"\${OWNER}\" '${REMOTE_DB_PATH}'
    fi
    if systemctl list-unit-files | grep -q '^${REMOTE_SERVICE}\.service'; then
      \$SUDO systemctl start '${REMOTE_SERVICE}'
    fi
    rm -f '${REMOTE_TMP_PATH}'
  "

  echo "Pushed ${LOCAL_DB_PATH} to ${REMOTE_DB_PATH}"
}

if [[ "${ACTION}" == "pull" ]]; then
  pull_db
else
  push_db
fi
