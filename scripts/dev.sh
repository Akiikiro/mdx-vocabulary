#!/usr/bin/env bash

set -u
set -o pipefail

SCRIPT_DIR=$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd -P -- "$SCRIPT_DIR/.." && pwd)
RUN_DIR="$REPO_ROOT/.run"

BACKEND_URL="http://127.0.0.1:3000"
FRONTEND_URL="http://127.0.0.1:5173"

mkdir -p "$RUN_DIR"

pid_file() { printf '%s/%s.pid' "$RUN_DIR" "$1"; }
log_file() { printf '%s/%s.log' "$RUN_DIR" "$1"; }

expected_command() {
  case "$1" in
    backend) printf '%s' 'npm run api' ;;
    frontend) printf '%s' 'npm run dev' ;;
  esac
}

read_pid() {
  local file
  file=$(pid_file "$1")
  [[ -f "$file" ]] || return 1
  local pid
  IFS= read -r pid < "$file" || return 1
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || return 1
  printf '%s' "$pid"
}

process_exists() {
  kill -0 "$1" 2>/dev/null
}

is_managed_process() {
  local service=$1 pid=$2 command expected
  process_exists "$pid" || return 1
  command=$(/bin/ps -p "$pid" -o command= 2>/dev/null) || return 1
  expected=$(expected_command "$service")
  [[ "$command" == *"$expected"* ]]
}

process_group_exists() {
  kill -0 -- "-$1" 2>/dev/null
}

is_managed_group() {
  local service=$1 pgid=$2 marker
  process_group_exists "$pgid" || return 1
  case "$service" in
    backend) marker="$REPO_ROOT/node_modules/.bin/tsx src/api.ts" ;;
    frontend) marker="$REPO_ROOT/web/node_modules/.bin/vite" ;;
  esac
  /bin/ps -ax -o pgid=,command= | /usr/bin/awk -v group="$pgid" -v marker="$marker" '
    $1 == group && index($0, marker) { found = 1 }
    END { exit(found ? 0 : 1) }
  '
}

is_managed_service() {
  is_managed_process "$1" "$2" || is_managed_group "$1" "$2"
}

service_status() {
  local service=$1 label=$2 file pid=''
  file=$(pid_file "$service")
  if [[ ! -f "$file" ]]; then
    printf '%-9s stopped\n' "$label:"
    return 1
  fi

  pid=$(read_pid "$service" 2>/dev/null || true)
  if [[ -n "$pid" ]] && is_managed_service "$service" "$pid"; then
    printf '%-9s running (PID %s)\n' "$label:" "$pid"
    return 0
  fi

  rm -f -- "$file"
  printf '%-9s stopped (removed stale PID file)\n' "$label:"
  return 1
}

print_status() {
  service_status backend Backend || true
  printf '%-9s %s\n' 'API:' "$BACKEND_URL"
  printf '%-9s %s/docs/\n' 'Swagger:' "$BACKEND_URL"
  service_status frontend Frontend || true
  printf '%-9s %s\n' 'Web:' "$FRONTEND_URL"
}

wait_until_ready() {
  local pid=$1 url=$2
  local attempt
  for attempt in {1..40}; do
    process_exists "$pid" || return 1
    if /usr/bin/curl --silent --fail --max-time 1 --output /dev/null "$url"; then
      process_exists "$pid" && return 0
    fi
    sleep 0.25
  done
  return 1
}

start_service() {
  local service=$1 workdir=$2 script=$3 health_url=$4
  local file log pid pgid
  file=$(pid_file "$service")
  log=$(log_file "$service")

  if [[ -f "$file" ]]; then
    pid=$(read_pid "$service" 2>/dev/null || true)
    if [[ -n "$pid" ]] && is_managed_service "$service" "$pid"; then
      printf '%s already running (PID %s)\n' "$service" "$pid"
      return 0
    fi
    rm -f -- "$file"
    printf 'Removed stale %s PID file.\n' "$service"
  fi

  printf '\n[%s] Starting %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$service" >> "$log"

  # Job control gives the background npm process its own process group. All npm,
  # shell, and Node descendants inherit it, so stop can terminate the whole tree.
  set -m
  (
    cd "$workdir" || exit 1
    exec npm run "$script"
  ) >> "$log" 2>&1 &
  pid=$!
  set +m

  pgid=$(/bin/ps -p "$pid" -o pgid= 2>/dev/null | /usr/bin/tr -d ' ')
  if [[ "$pgid" != "$pid" ]]; then
    kill -TERM "$pid" 2>/dev/null || true
    printf 'Failed to start %s safely: could not create a dedicated process group. See %s\n' "$service" "$log" >&2
    return 1
  fi

  printf '%s\n' "$pid" > "$file"
  if wait_until_ready "$pid" "$health_url"; then
    printf 'Started %s (PID %s).\n' "$service" "$pid"
    return 0
  fi

  kill -TERM -- "-$pid" 2>/dev/null || true
  rm -f -- "$file"
  printf 'Failed to start %s. See %s\n' "$service" "$log" >&2
  return 1
}

start_all() {
  local failed=0
  start_service backend "$REPO_ROOT" api "$BACKEND_URL/api/dictionaries" || failed=1
  start_service frontend "$REPO_ROOT/web" dev "$FRONTEND_URL/" || failed=1
  printf '\n'
  print_status
  return "$failed"
}

stop_service() {
  local service=$1 file pid=''
  file=$(pid_file "$service")
  if [[ ! -f "$file" ]]; then
    printf '%s already stopped.\n' "$service"
    return 0
  fi

  pid=$(read_pid "$service" 2>/dev/null || true)
  if [[ -z "$pid" ]] || ! is_managed_service "$service" "$pid"; then
    rm -f -- "$file"
    printf '%s already stopped; removed stale PID file.\n' "$service"
    return 0
  fi

  kill -TERM -- "-$pid" 2>/dev/null || true
  local attempt
  for attempt in {1..20}; do
    process_group_exists "$pid" || break
    sleep 0.25
  done

  if process_group_exists "$pid"; then
    printf '%s did not stop after SIGTERM; sending SIGKILL.\n' "$service" >&2
    kill -KILL -- "-$pid" 2>/dev/null || true
    for attempt in {1..8}; do
      process_group_exists "$pid" || break
      sleep 0.25
    done
  fi

  rm -f -- "$file"
  if process_group_exists "$pid"; then
    printf 'Failed to stop %s process group %s.\n' "$service" "$pid" >&2
    return 1
  fi
  printf 'Stopped %s.\n' "$service"
}

stop_all() {
  local failed=0
  stop_service frontend || failed=1
  stop_service backend || failed=1
  return "$failed"
}

usage() {
  printf 'Usage: %s {start|stop|restart|status}\n' "$0" >&2
}

case "${1:-}" in
  start) start_all ;;
  stop) stop_all ;;
  restart)
    stop_all
    start_all
    ;;
  status) print_status ;;
  *) usage; exit 2 ;;
esac
