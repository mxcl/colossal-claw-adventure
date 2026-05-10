# shellcheck shell=bash
# Shared terminal presentation helpers for repository scripts.

if [[ -n "${CCA_CLI_SH:-}" ]]; then
  return 0
fi
CCA_CLI_SH=1

if [[ -t 2 ]]; then
  CCA_CLI_TTY=1
else
  CCA_CLI_TTY=0
fi

if [[ "${CCA_CLI_TTY}" == "1" && -z "${NO_COLOR:-}" && "${TERM:-}" != "dumb" ]]; then
  CCA_CLI_COLOR=1
else
  CCA_CLI_COLOR=0
fi

if [[ "${CCA_CLI_COLOR}" == "1" ]]; then
  CCA_RESET=$'\033[0m'
  CCA_BOLD=$'\033[1m'
  CCA_DIM=$'\033[2m'
  CCA_RED=$'\033[31m'
  CCA_GREEN=$'\033[32m'
  CCA_YELLOW=$'\033[33m'
  CCA_BLUE=$'\033[34m'
  CCA_CYAN=$'\033[36m'
else
  CCA_RESET=""
  CCA_BOLD=""
  CCA_DIM=""
  CCA_RED=""
  CCA_GREEN=""
  CCA_YELLOW=""
  CCA_BLUE=""
  CCA_CYAN=""
fi

if [[ "${CCA_CLI_TTY}" == "1" && "${TERM:-}" != "dumb" ]]; then
  CCA_STEP="◆"
  CCA_OK="✓"
  CCA_WARN="!"
  CCA_ERROR="✗"
else
  CCA_STEP="-"
  CCA_OK="OK"
  CCA_WARN="WARN"
  CCA_ERROR="ERROR"
fi

cli_banner() {
  local title="$1"
  local subtitle="${2:-}"

  if [[ "${CCA_CLI_TTY}" == "1" && "${TERM:-}" != "dumb" ]]; then
    printf '%b╭─ %s%b\n' "${CCA_CYAN}" "${title}" "${CCA_RESET}" >&2
    if [[ -n "${subtitle}" ]]; then
      printf '%b│%b  %s\n' "${CCA_CYAN}" "${CCA_RESET}" "${subtitle}" >&2
    fi
    printf '%b╰─%b\n' "${CCA_CYAN}" "${CCA_RESET}" >&2
  else
    printf '%s\n' "${title}" >&2
    if [[ -n "${subtitle}" ]]; then
      printf '%s\n' "${subtitle}" >&2
    fi
  fi
}

cli_section() {
  printf '\n%b%s%b\n' "${CCA_BOLD}" "$1" "${CCA_RESET}" >&2
}

cli_step() {
  printf '%b%s%b %s\n' "${CCA_BLUE}" "${CCA_STEP}" "${CCA_RESET}" "$1" >&2
}

cli_ok() {
  printf '%b%s%b %s\n' "${CCA_GREEN}" "${CCA_OK}" "${CCA_RESET}" "$1" >&2
}

cli_warn() {
  printf '%b%s%b %s\n' "${CCA_YELLOW}" "${CCA_WARN}" "${CCA_RESET}" "$1" >&2
}

cli_error() {
  printf '%b%s%b %s\n' "${CCA_RED}" "${CCA_ERROR}" "${CCA_RESET}" "$1" >&2
}

cli_die() {
  local message="$1"
  local fix="${2:-}"

  cli_error "${message}"
  if [[ -n "${fix}" ]]; then
    printf '%bTo fix:%b %s\n' "${CCA_BOLD}" "${CCA_RESET}" "${fix}" >&2
  fi
  exit 1
}

cli_kv() {
  local key="$1"
  local value="$2"

  printf '  %b%-18s%b %s\n' "${CCA_DIM}" "${key}" "${CCA_RESET}" "${value}" >&2
}

cli_require_cmd() {
  local cmd="$1"
  local hint="${2:-Install ${cmd} and re-run this script.}"

  if ! command -v "${cmd}" >/dev/null 2>&1; then
    cli_die "Missing required command: ${cmd}" "${hint}"
  fi
}

cli_require_env() {
  local name="$1"
  local value="${!name:-}"

  if [[ -z "${value}" ]]; then
    cli_die "Missing required environment variable: ${name}" \
      "Export ${name}, or run from a direnv shell with .envrc loaded."
  fi
}
