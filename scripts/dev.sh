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

service_port() {
  case "$1" in
    backend) printf '%s' '3000' ;;
    frontend) printf '%s' '5173' ;;
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

listener_pid() {
  /usr/sbin/lsof -nP -a -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | /usr/bin/sort -u | /usr/bin/head -n 1
}

is_project_listener() {
  local service=$1 pid=$2 command
  process_exists "$pid" || return 1
  command=$(/bin/ps -p "$pid" -o command= 2>/dev/null) || return 1
  case "$service" in
    backend) [[ "$command" == *"$REPO_ROOT/node_modules/tsx/"* && "$command" == *'src/api.ts'* ]] ;;
    frontend) [[ "$command" == *"$REPO_ROOT/web/node_modules/.bin/vite"* ]] ;;
  esac
}

process_group_exists() {
  kill -0 -- "-$1" 2>/dev/null
}

is_managed_group() {
  local service=$1 pgid=$2 marker wrapper
  process_group_exists "$pgid" || return 1
  case "$service" in
    backend) marker="$REPO_ROOT/node_modules/tsx/"; wrapper='npm run api' ;;
    frontend) marker="$REPO_ROOT/web/node_modules/.bin/vite"; wrapper='npm run dev' ;;
  esac
  /bin/ps -ax -o pgid=,command= | /usr/bin/awk -v group="$pgid" -v marker="$marker" -v wrapper="$wrapper" '
    $1 == group && index($0, marker) { listener = 1 }
    $1 == group && index($0, wrapper) { parent = 1 }
    END { exit(listener && parent ? 0 : 1) }
  '
}

write_listener_pid() {
  printf '%s\n' "$2" > "$(pid_file "$1")"
}

service_status() {
  local service=$1 label=$2 file port listener recorded=''
  file=$(pid_file "$service")
  port=$(service_port "$service")
  listener=$(listener_pid "$port" || true)
  recorded=$(read_pid "$service" 2>/dev/null || true)
  if [[ -n "$listener" ]] && is_project_listener "$service" "$listener"; then
    if [[ "$recorded" != "$listener" ]]; then
      write_listener_pid "$service" "$listener"
    fi
    printf '%-9s running (listener PID %s, port %s)\n' "$label:" "$listener" "$port"
    return 0
  fi
  [[ -f "$file" ]] && rm -f -- "$file"
  if [[ -n "$listener" ]]; then
    printf '%-9s occupied by unrelated listener PID %s on port %s\n' "$label:" "$listener" "$port"
  elif [[ -n "$recorded" ]]; then
    printf '%-9s stopped (removed stale PID file)\n' "$label:"
  else
    printf '%-9s stopped\n' "$label:"
  fi
  return 1
}

print_status() {
  service_status backend Backend || true
  printf '%-9s %s\n' 'API:' "$BACKEND_URL"
  printf '%-9s %s/docs/\n' 'Swagger:' "$BACKEND_URL"
  service_status frontend Frontend || true
  printf '%-9s %s\n' 'Web:' "$FRONTEND_URL"
}

start_service() {
  local service=$1 workdir=$2 script=$3 health_url=$4
  local file log pid pgid port listener recorded=''
  file=$(pid_file "$service")
  log=$(log_file "$service")
  port=$(service_port "$service")
  listener=$(listener_pid "$port" || true)
  recorded=$(read_pid "$service" 2>/dev/null || true)

  if [[ -n "$listener" ]]; then
    if is_project_listener "$service" "$listener"; then
      write_listener_pid "$service" "$listener"
      printf '%s already running (listener PID %s, port %s)\n' "$service" "$listener" "$port"
      return 0
    fi
    [[ -f "$file" ]] && rm -f -- "$file"
    printf 'Cannot start %s: port %s is occupied by unrelated listener PID %s.\n' "$service" "$port" "$listener" >&2
    return 1
  fi
  if [[ -f "$file" ]]; then
    rm -f -- "$file"
    if [[ -n "$recorded" ]]; then
      printf 'Removed stale %s PID file (recorded PID %s; no listener on port %s).\n' "$service" "$recorded" "$port"
    else
      printf 'Removed invalid %s PID file; no listener on port %s.\n' "$service" "$port"
    fi
  fi

  printf '\n[%s] Starting %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$service" >> "$log"

  # Node's detached spawn creates a new process group without changing monitor
  # mode in the caller's terminal. Descendants inherit the group, so stop can
  # still terminate the complete npm/Node tree by its tracked leader PID.
  pid=$(/usr/bin/env node -e '
    const fs = require("node:fs");
    const { spawn } = require("node:child_process");
    const [workdir, script, log] = process.argv.slice(1);
    const output = fs.openSync(log, "a");
    const child = spawn("npm", ["run", script], {
      cwd: workdir,
      env: process.env,
      detached: true,
      stdio: ["ignore", output, output],
    });
    child.once("error", (error) => {
      fs.closeSync(output);
      console.error(error.message);
      process.exitCode = 1;
    });
    child.once("spawn", () => {
      fs.closeSync(output);
      process.stdout.write(String(child.pid));
      child.unref();
    });
  ' "$workdir" "$script" "$log") || {
    printf 'Failed to spawn %s. See %s\n' "$service" "$log" >&2
    return 1
  }

  if [[ ! "$pid" =~ ^[1-9][0-9]*$ ]]; then
    printf 'Failed to start %s safely: invalid child PID. See %s\n' "$service" "$log" >&2
    return 1
  fi

  pgid=$(/bin/ps -p "$pid" -o pgid= 2>/dev/null | /usr/bin/tr -d ' ')
  if [[ "$pgid" != "$pid" ]]; then
    kill -TERM "$pid" 2>/dev/null || true
    printf 'Failed to start %s safely: could not create a dedicated process group. See %s\n' "$service" "$log" >&2
    return 1
  fi

  for _attempt in {1..40}; do
    listener=$(listener_pid "$port" || true)
    if [[ -n "$listener" ]] && is_project_listener "$service" "$listener" \
      && /usr/bin/curl --silent --fail --max-time 1 --output /dev/null "$health_url"; then
      write_listener_pid "$service" "$listener"
      printf 'Started %s (listener PID %s, port %s).\n' "$service" "$listener" "$port"
      return 0
    fi
    process_group_exists "$pid" || break
    sleep 0.25
  done

  if is_managed_group "$service" "$pid"; then
    kill -TERM -- "-$pid" 2>/dev/null || true
  else
    kill -TERM "$pid" 2>/dev/null || true
  fi
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
  local service=$1 file port listener pgid=''
  file=$(pid_file "$service")
  port=$(service_port "$service")
  listener=$(listener_pid "$port" || true)
  if [[ -z "$listener" ]]; then
    [[ -f "$file" ]] && rm -f -- "$file"
    printf '%s already stopped; no listener on port %s.\n' "$service" "$port"
    return 0
  fi
  if ! is_project_listener "$service" "$listener"; then
    [[ -f "$file" ]] && rm -f -- "$file"
    printf 'Refusing to stop %s: port %s belongs to unrelated listener PID %s.\n' "$service" "$port" "$listener" >&2
    return 1
  fi

  pgid=$(/bin/ps -p "$listener" -o pgid= 2>/dev/null | /usr/bin/tr -d ' ')
  if [[ -n "$pgid" ]] && is_managed_group "$service" "$pgid"; then
    kill -TERM -- "-$pgid" 2>/dev/null || true
  else
    kill -TERM "$listener" 2>/dev/null || true
  fi
  local attempt
  for attempt in {1..20}; do
    [[ -z "$(listener_pid "$port" || true)" ]] && break
    sleep 0.25
  done

  listener=$(listener_pid "$port" || true)
  if [[ -n "$listener" ]] && is_project_listener "$service" "$listener"; then
    printf '%s did not stop after SIGTERM; sending SIGKILL.\n' "$service" >&2
    kill -KILL "$listener" 2>/dev/null || true
    for attempt in {1..8}; do
      [[ -z "$(listener_pid "$port" || true)" ]] && break
      sleep 0.25
    done
  fi

  rm -f -- "$file"
  listener=$(listener_pid "$port" || true)
  if [[ -n "$listener" ]]; then
    printf 'Failed to stop %s listener PID %s on port %s.\n' "$service" "$listener" "$port" >&2
    return 1
  fi
  printf 'Stopped %s; port %s is free.\n' "$service" "$port"
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
