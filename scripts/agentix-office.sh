#!/usr/bin/env bash
# One command for the agentix office on a Windows laptop with Docker, run from Git Bash in the repo root:
#
#   scripts/agentix-office.sh start    # make sure the container, its dependencies and both servers are up
#   scripts/agentix-office.sh status   # what is running, and the address
#   scripts/agentix-office.sh stop     # stop the two servers; the container and all data stay
#
# Everything runs inside the container, so nothing gets installed on the computer. It never deletes a
# container, a volume or an image, and running `start` twice does no harm. If the container is gone it
# is made again from the image `agent-office-dev` (built from .devcontainer/ if that is missing).
#
# Settings, for a second office next to the real one (a test, say):
#   AGENTIX_CONTAINER     container name                       (agentix-office)
#   AGENTIX_PORT          port on this computer, 127.0.0.1 only (5173)
#   AGENTIX_IMAGE         image                                (agent-office-dev)
#   AGENTIX_NODE_VOLUME   volume with node_modules             (agent-office-node-modules)
#   AGENTIX_CLAUDE_VOLUME volume with the Claude Code login    (agentix-office-claude)
#   AGENTIX_PASSWORD      the office password                  (dev)
#   AGENTIX_CPUS          CPUs the container may use           (4)
#   AGENTIX_WATCH         1: restart the server when a file changes (0, see below)
#   AGENTIX_POLL          1: Vite polls its files once a second, to see edits made on Windows (0)
#   AGENTIX_AGENT         a --agent for the server, e.g. a script of your own  (unset: the default agent)
set -euo pipefail

NAME="${AGENTIX_CONTAINER:-agentix-office}"
PORT="${AGENTIX_PORT:-5173}"
IMAGE="${AGENTIX_IMAGE:-agent-office-dev}"
NODE_VOLUME="${AGENTIX_NODE_VOLUME:-agent-office-node-modules}"
CLAUDE_VOLUME="${AGENTIX_CLAUDE_VOLUME:-agentix-office-claude}"
PASSWORD="${AGENTIX_PASSWORD:-dev}"
CPUS="${AGENTIX_CPUS:-4}"
# The Windows folder mount passes no file-change events into the container (checked: a watcher saw
# nothing, not even a write made from inside), so the server's restart-on-change can never fire and
# only costs CPU: off by default. The same is true for Vite, which then keeps serving a file as it first
# read it until Vite restarts; AGENTIX_POLL=1 makes Vite look at its files once a second instead.
WATCH="${AGENTIX_WATCH:-0}"
POLL="${AGENTIX_POLL:-0}"
AGENT="${AGENTIX_AGENT:-}"

WORK=/workspaces/agent-office
VITE_PORT=5173
SERVER_PORT=4600
CLAUDE_HOME=/home/node/.claude

# Git Bash turns /paths into C:\paths on their way to docker.exe, which breaks every container path.
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL='*'

say() { printf '%s\n' "$*"; }
die() { printf 'agentix-office: %s\n' "$*" >&2; exit 1; }

# The repo root, as the Windows path Docker wants for the bind mount.
root() {
  local here
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && (pwd -W 2>/dev/null || pwd))"
  printf '%s' "$here"
}

# Run something inside the container, as the normal user.
inbox() { docker exec -w "$WORK" "$NAME" "$@"; }
asroot() { docker exec -u root "$NAME" "$@"; }

need_docker() {
  command -v docker >/dev/null 2>&1 || die "docker is not installed (or not on the PATH of this shell)."
  if ! docker info >/dev/null 2>&1; then
    die "Docker is not running. Start Docker Desktop, wait until it says the engine is running, then run this again."
  fi
}

container_state() { docker inspect -f '{{.State.Status}}' "$NAME" 2>/dev/null || true; }

ensure_image() {
  if docker image inspect "$IMAGE" >/dev/null 2>&1; then return; fi
  say "Image $IMAGE is missing: building it from .devcontainer/ (a few minutes, needs the internet)."
  docker build -t "$IMAGE" "$(root)/.devcontainer"
}

ensure_container() {
  case "$(container_state)" in
    running) return ;;
    "")
      ensure_image
      say "Container $NAME is missing: creating it."
      docker run -d --name "$NAME" \
        --user node -w "$WORK" \
        --cpus "$CPUS" --restart unless-stopped \
        -e LAB_BROWSER=chromium \
        -e AGENT_OFFICE_HOME="$WORK" \
        -e CLAUDE_CONFIG_DIR="$CLAUDE_HOME" \
        -v "$(root):$WORK" \
        -v "$NODE_VOLUME:$WORK/node_modules" \
        -v "$CLAUDE_VOLUME:$CLAUDE_HOME" \
        -p "127.0.0.1:$PORT:$VITE_PORT" \
        "$IMAGE" sleep infinity >/dev/null
      ;;
    *)
      say "Container $NAME is stopped: starting it."
      docker start "$NAME" >/dev/null
      ;;
  esac
  # Fresh volumes belong to root; the node user has to be able to write to them.
  [ "$(inbox stat -c %U node_modules)" = node ] || asroot chown node:node "$WORK/node_modules"
  if docker exec "$NAME" sh -c "[ -d '$CLAUDE_HOME' ]" 2>/dev/null; then
    [ "$(docker exec "$NAME" stat -c %U "$CLAUDE_HOME")" = node ] || asroot chown -R node:node "$CLAUDE_HOME"
  fi
  # The tests run git in the repo, and git distrusts a folder that another user's mount owns.
  docker exec -w / "$NAME" sh -c "git config --global --get-all safe.directory | grep -qx '$WORK' || git config --global --add safe.directory '$WORK'" || true
}

ensure_dependencies() {
  if inbox sh -c '[ -x node_modules/.bin/vite ] && [ -x node_modules/.bin/tsx ]'; then return; fi
  say "node_modules is empty: running npm ci (a few minutes, needs the internet)."
  inbox nice -n 10 npm ci --ignore-scripts --no-audit --no-fund
}

# Is the process in this pid file alive?
# (A finished process lingers as a zombie in this container, which kill -0 still reports as alive.)
alive() { inbox sh -c "p=\$(cat /tmp/$1.pid 2>/dev/null) && [ -n \"\$p\" ] && s=\$(ps -o stat= -p \"\$p\" 2>/dev/null) && [ -n \"\$s\" ] && [ \"\${s#Z}\" = \"\$s\" ]"; }

# Start a command in a session of its own (so stop can end all of it), pid in /tmp/<name>.pid.
launch() {
  local name="$1"; shift
  alive "$name" && return 0
  docker exec -d -w "$WORK" -e "AGENTIX_POLL=$POLL" "$NAME" setsid sh -c "echo \$\$ >/tmp/$name.pid; exec \"\$@\" >/tmp/$name.log 2>&1" sh "$@"
}

http_code() { docker exec "$NAME" curl -s -o /dev/null -m 5 -w '%{http_code}' "$1" 2>/dev/null || true; }

wait_for() {
  local what="$1" url="$2" proc="$3" i code
  for i in $(seq 1 90); do
    code="$(http_code "$url")"
    case "$code" in 2* | 3* | 401 | 403) return 0 ;; esac
    if ! alive "$proc"; then
      say "--- last lines of /tmp/$proc.log ---"
      inbox tail -n 15 "/tmp/$proc.log" || true
      die "$what stopped while starting (see above)."
    fi
    sleep 2
  done
  die "$what did not answer within 3 minutes. See: docker exec $NAME tail -n 30 /tmp/$proc.log"
}

# The server serves the login page from the built client and will not start without it, even though in
# development Vite serves the rest. A fresh clone has none yet: build it once (a few minutes).
ensure_bundle() {
  if inbox sh -c '[ -f dist/public/login.html ]'; then return; fi
  say "The client has not been built here yet: building it once (a few minutes)."
  inbox nice -n 10 npm run -s build:client
}

claude_login_present() {
  docker exec "$NAME" sh -c 'for d in "${CLAUDE_CONFIG_DIR:-$HOME/.claude}" "$HOME/.claude"; do [ -f "$d/.credentials.json" ] && exit 0; done; exit 1'
}

start() {
  need_docker
  ensure_container
  ensure_dependencies
  ensure_bundle

  local server_cmd=(node_modules/.bin/tsx src/server/cli.ts --port "$SERVER_PORT" --password "$PASSWORD" --no-open)
  [ "$WATCH" = 1 ] && server_cmd=(node_modules/.bin/tsx watch src/server/cli.ts --port "$SERVER_PORT" --password "$PASSWORD" --no-open)
  [ -n "$AGENT" ] && server_cmd+=(--agent "$AGENT")
  launch agentix-server "${server_cmd[@]}"
  launch agentix-vite node_modules/.bin/vite --host 0.0.0.0 --port "$VITE_PORT" --strictPort
  wait_for "The office server" "http://127.0.0.1:$SERVER_PORT/login" agentix-server
  wait_for "Vite" "http://127.0.0.1:$VITE_PORT/" agentix-vite

  say ""
  say "The office is up:  http://localhost:$PORT"
  say "Password:          $PASSWORD"
  if ! claude_login_present; then
    say ""
    say "Claude Code is not signed in inside the container yet. Once, run:"
    say "  docker exec -it $NAME claude auth login"
    say "(The login is kept in the volume $CLAUDE_VOLUME, so it survives the container being made again.)"
  fi
  if ! docker inspect -f '{{range .Mounts}}{{.Name}} {{end}}' "$NAME" | grep -qw "$CLAUDE_VOLUME"; then
    say ""
    say "Note: this container was made before the login volume existed, so its Claude login would be lost if"
    say "the container is ever removed. Anything made by 'start' from now on has the volume."
  fi
  if ! docker exec "$NAME" sh -c 'ls "$HOME/.cache/ms-playwright" 2>/dev/null | grep -q .'; then
    say ""
    say "The headless browser for screenshots is not installed here. If you need it:"
    say "  docker exec -it $NAME sh -c 'sudo npx playwright-core install --with-deps chromium'"
  fi
}

stop() {
  need_docker
  [ "$(container_state)" = running ] || { say "Container $NAME is not running; nothing to stop."; return 0; }
  local n pid
  for n in agentix-vite agentix-server; do
    if alive "$n"; then
      pid="$(inbox cat "/tmp/$n.pid")"
      # Each runs in a session of its own, so this ends it and whatever it started, and nothing else.
      inbox sh -c "kill -TERM -- -$pid 2>/dev/null || kill -TERM $pid 2>/dev/null; rm -f /tmp/$n.pid" || true
      say "Stopped $n."
    else
      say "$n was not running."
    fi
  done
  say "Container $NAME and everything in it is left as it is. 'start' brings the office back."
}

status() {
  need_docker
  local state; state="$(container_state)"
  if [ -z "$state" ]; then say "Container $NAME: missing (start makes it)."; return 0; fi
  say "Container $NAME: $state"
  [ "$state" = running ] || return 0
  local n
  for n in agentix-server agentix-vite; do
    if alive "$n"; then say "$n: running (pid $(inbox cat "/tmp/$n.pid"))"; else say "$n: not running"; fi
  done
  say "Server answers: $(http_code "http://127.0.0.1:$SERVER_PORT/login")   Vite answers: $(http_code "http://127.0.0.1:$VITE_PORT/")"
  say "Address: http://localhost:$PORT   Password: $PASSWORD"
  if claude_login_present; then say "Claude Code login: present"; else say "Claude Code login: missing (docker exec -it $NAME claude auth login)"; fi
  docker stats --no-stream --format 'CPU {{.CPUPerc}}   memory {{.MemUsage}}' "$NAME"
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  status) status ;;
  *) say "usage: scripts/agentix-office.sh start | stop | status"; exit 2 ;;
esac
