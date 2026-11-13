#!/usr/bin/env bash
# portable/deploy.sh — run on the LOCAL Windows Git Bash machine (worktree root).
# Syncs the working tree to the build server and drives orchestrate.sh phases.
#   portable/deploy.sh sync                  # tar working tree -> server src/
#   portable/deploy.sh run <orchestrate args...>
#   portable/deploy.sh fetch                 # pull status/evidence back into portable/status/
set -uo pipefail
SRV="${FT_SERVER:-cc@192.168.100.200}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRV_ROOT="${FT_SRV_ROOT:-/home/cc/formal-tools-build}"

case "${1:?usage: deploy.sh sync|run|fetch}" in
  sync)
    head=$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)
    dirty=$(git -C "$ROOT" status --porcelain | wc -l)
    echo "deploying worktree to $SRV:$SRV_ROOT/src (HEAD=$head dirty_files=$dirty)"
    tar -C "$ROOT" --exclude=.git --exclude=node_modules --exclude='portable/status' -cf - . \
      | ssh "$SRV" "mkdir -p $SRV_ROOT/src && tar -xf - -C $SRV_ROOT/src"
    ssh "$SRV" "echo '$head' > $SRV_ROOT/src/portable/.deploy-head; echo '$dirty' > $SRV_ROOT/src/portable/.deploy-dirty"
    echo "synced."
    ;;
  run)
    shift
    ssh "$SRV" "bash $SRV_ROOT/src/portable/orchestrate.sh $*"
    ;;
  fetch)
    mkdir -p "$ROOT/portable/status"
    ssh "$SRV" "cd $SRV_ROOT/src/portable/status && tar -cf - ." | tar -xf - -C "$ROOT/portable/status"
    echo "status fetched into portable/status/"
    ;;
esac
