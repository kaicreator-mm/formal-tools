#!/usr/bin/env bash
# portable/orchestrate.sh — server-side driver. Usage (on build server):
#   orchestrate.sh init            # pull debian:13 (mirror-bypass), build ft-builder image
#   orchestrate.sh runtimes        # build shared runtimes (python313/node22/java21) + py deps
#   orchestrate.sh build <id|all>  # build tool payloads into out/tools/<id>
#   orchestrate.sh verify <id|all> # pack bundle, then offline verification in fresh debian:13
#   orchestrate.sh pack            # assemble bundle + packages + SHA256SUMS
#   orchestrate.sh receipts        # evidence TSVs -> JSON receipts -> repo portable/status/
#   orchestrate.sh status [ids]    # show build/verify status table
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=env.sh
source "$HERE/env.sh"
mkdir -p "$FT_OUT" "$FT_CACHE" "$FT_PKG_DIR" "$FT_EV_DIR" "$FT_OUT/logs" "$FT_OUT/receipts" "$FT_OUT/tools"

img() { docker image inspect "$1" >/dev/null 2>&1; }

ensure_debian() {
  if ! img "$FT_RT_IMG"; then
    echo "pulling $FT_RT_IMG via daocloud bypass (daemon mirror is dead; no sudo)"
    docker pull -q docker.m.daocloud.io/library/debian:13 || return 1
    docker tag docker.m.daocloud.io/library/debian:13 "$FT_RT_IMG"
  fi
}

builder_image() {
  if ! img "$FT_IMG"; then
    ensure_debian || return 1
    docker build -q -t "$FT_IMG" "$FT_SRC/builders" || return 1
  fi
}

# tools whose build mutates the shared python runtime -> serialized
is_serial() {
  case "$(spec_kind "$1")" in python*) return 0 ;; *) return 1 ;; esac
}
spec_kind() {
  grep -m1 '^FT_TOOL_KIND=' "$FT_SRC/builders/tools/$1.sh" 2>/dev/null | cut -d= -f2 | tr -d '"' || echo unknown
}
all_tool_ids() {
  for f in "$FT_SRC"/builders/tools/*.sh; do basename "$f" .sh; done | sort
}

container_env=(-e FT_SRC=/src -e FT_OUT=/out -e FT_CACHE=/cache -e HOME=/tmp)

do_runtimes() {
  builder_image || exit 1
  docker run --rm "${container_env[@]}" \
    -v "$FT_SRC:/src:ro" -v "$FT_OUT:/out" -v "$FT_CACHE:/cache" \
    "$FT_IMG" bash /src/builders/build-runtimes.sh || exit 1
}

do_build() {
  builder_image || exit 1
  local ids=()
  if [ "${1:-all}" = "all" ]; then mapfile -t ids < <(all_tool_ids); else ids=("$@"); fi
  local serial=() parallel=() id
  for id in "${ids[@]}"; do
    if is_serial "$id"; then serial+=("$id"); else parallel+=("$id"); fi
  done
  build_jobs "${parallel[@]}"
  build_jobs "${serial[@]}"   # python tools: one at a time (shared site-packages)
}

build_one() {
  local id="$1"
  echo ">> building $id"
  # storm: payload comes from a host-side docker-image extraction (no docker socket in builder)
  if [ "$id" = storm ]; then
    bash "$FT_SRC/builders/host/storm-prepare.sh" || echo "storm host-prepare failed (spec will record UNAVAILABLE)" >&2
  fi
  docker run --rm "${container_env[@]}" \
    -v "$FT_SRC:/src:ro" -v "$FT_OUT:/out" -v "$FT_CACHE:/cache" \
    "$FT_IMG" bash /src/builders/build-tool.sh "$id" >/dev/null 2>&1
  echo "$?" > "$FT_OUT/logs/$id.exit"
  local st=FAIL; [ "$(cat "$FT_OUT/logs/$id.exit")" = 0 ] && st=OK
  echo "   $id: $st (log: $FT_OUT/logs/$id.build.log)"
}

build_jobs() {
  local -a ids=("$@") running=0
  for id in "${ids[@]}"; do
    build_one "$id" &
    running=$((running+1))
    while [ "$running" -ge "$FT_CONC" ]; do wait -n; running=$((running-1)); done
  done
  wait
}

do_pack() { bash "$FT_SRC/packaging/pack.sh"; }

do_verify() {
  [ -d "$FT_BUNDLE/runtimes" ] || { echo "bundle missing; run 'pack' first"; exit 1; }
  local ids=() id rc_all=0
  if [ "${1:-all}" = "all" ]; then mapfile -t ids < <(all_tool_ids); else ids=("$@"); fi
  for id in "${ids[@]}"; do
    echo ">> verify $id (fresh offline debian:13)"
    docker run --rm --network none \
      -v "$FT_BUNDLE:/bundle:ro" -v "$FT_EV_DIR:/evidence" \
      -e FT_EVIDENCE_DIR=/evidence -e HOME=/tmp \
      "$FT_RT_IMG" /bundle/bin/tool-runner verify "$id" || rc_all=1
  done
  return "$rc_all"
}

do_receipts() {
  local py
  py=$(command -v python3 || true)
  if [ -z "$py" ]; then
    docker run --rm -v "$FT_REPO_ROOT:/repo:ro" -v "$FT_OUT:/out" "$FT_IMG" \
      python3 /src/portable/verification/build-receipts.py /out /repo/portable/status
  else
    "$py" "$FT_SRC/verification/build-receipts.py" "$FT_OUT" "$FT_REPO_ROOT/portable/status"
  fi
}

do_status() {
  printf '%-14s %-8s %-10s %-8s %s\n' TOOL BUILD VERIFY VERSION NOTE
  for id in "${@:-$(all_tool_ids)}"; do
    local b="?" v="?" ver="-" note=""
    [ -f "$FT_OUT/logs/$id.exit" ] && { [ "$(cat "$FT_OUT/logs/$id.exit")" = 0 ] && b=OK || b=FAIL; }
    [ -f "$FT_EV_DIR/verify-$id.tsv" ] && {
      if awk -F'\t' '$1=="verdict"{exit ($2=="PASS")?0:1}' "$FT_EV_DIR/verify-$id.tsv"; then v=PASS; else v=FAIL; fi
    }
    local meta="$FT_OUT/tools/$id/meta.sh"
    [ -f "$meta" ] && ver=$(. "$meta"; echo "${TOOL_VERSION:-?}")
    [ -f "$FT_OUT/receipts/blockers.tsv" ] && note=$(awk -F'\t' -v t="$id" '$1==t{print $2}' "$FT_OUT/receipts/blockers.tsv")
    printf '%-14s %-8s %-10s %-8s %s\n' "$id" "$b" "$v" "$ver" "$note"
  done
}

case "${1:?usage: orchestrate.sh init|runtimes|build|pack|verify|receipts|status}" in
  init) ensure_debian && builder_image && echo "init OK" ;;
  runtimes) do_runtimes ;;
  build) shift; do_build "$@" ;;
  pack) do_pack ;;
  verify) shift; do_verify "$@" ;;
  receipts) do_receipts ;;
  status) shift; do_status "$@" ;;
  *) echo "unknown phase: $1"; exit 2 ;;
esac
