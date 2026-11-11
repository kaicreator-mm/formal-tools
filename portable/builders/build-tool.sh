#!/usr/bin/env bash
# portable/builders/build-tool.sh — generic per-tool build driver.
# Runs INSIDE the ft-builder container:  bash /src/builders/build-tool.sh <tool_id>
# Contract with specs (builders/tools/<id>.sh):
#   FT_TOOL_VERSION, FT_TOOL_KIND, FT_MAIN_BIN (bundle-relative ELF or ""), FT_PROBE=(rel cmd...)
#   ft_tool_build()  installs payload into $FT_TOOL_DIR, calls ft::make_shim as needed
set -uo pipefail

id="${1:?usage: build-tool.sh <tool_id>}"
export FT_SRC="${FT_SRC:?}" FT_OUT="${FT_OUT:?}" FT_CACHE="${FT_CACHE:?}"
export FT_TOOL_ID="$id"
export FT_LOG="$FT_OUT/logs/$id.build.log"
mkdir -p "$FT_OUT/logs"

spec="$FT_SRC/builders/tools/$id.sh"
if [ ! -f "$spec" ]; then echo "FATAL: no spec: $spec" >&2; exit 2; fi

# shellcheck source=lib.sh
source "$FT_SRC/builders/lib.sh"

rm -rf "$FT_TOOL_DIR"; mkdir -p "$FT_TOOL_DIR"
# shellcheck disable=SC1090
source "$spec"
ft::log "building $id version=${FT_TOOL_VERSION:-runtime-resolved} kind=${FT_TOOL_KIND:-binary}"

( ft_tool_build ); rc=$?
if [ "$rc" != 0 ]; then
  if [ -f "$FT_TOOL_DIR/UNAVAILABLE" ]; then
    ft::log "spec exited via ft::unavailable (rc=$rc) — writing meta and continuing"
  else
    ft::log "spec build failed rc=$rc"; ft::note build_status FAILED; exit "$rc"
  fi
fi

# ---- version resolution -----------------------------------------------------
# specs may resolve versions inside ft_tool_build (subshell) — pick up the .version marker
if [ -f "$FT_TOOL_DIR/.version" ]; then
  FT_TOOL_VERSION=$(cat "$FT_TOOL_DIR/.version")
fi

# ---- version probe (best effort) ------------------------------------------
FT_PROBE=("${FT_PROBE[@]:-}")
ver_out=""
if [ -f "$FT_TOOL_DIR/UNAVAILABLE" ]; then
  export M_UNAVAILABLE="1"
  export M_REASON="$(cat "$FT_TOOL_DIR/UNAVAILABLE")"
  ver_out="(unavailable)"
elif [ "${#FT_PROBE[@]}" -gt 0 ] && [ -n "${FT_PROBE[0]:-}" ]; then
  if [ -x "$FT_TOOL_DIR/${FT_PROBE[0]}" ]; then
    ver_out=$( cd "$FT_TOOL_DIR" && timeout 60 "./${FT_PROBE[0]}" "${FT_PROBE[@]:1}" 2>&1 | head -c 400 || true )
  else
    ver_out="(probe target missing: ./${FT_PROBE[0]})"
  fi
fi

# ---- ELF audit --------------------------------------------------------------
glibc_max=""; elf_arch=""; needed_libs=""
[ -n "${M_UNAVAILABLE:-}" ] && FT_MAIN_BIN=""
if [ -n "${FT_MAIN_BIN:-}" ] && [ -f "$FT_OUT/$FT_MAIN_BIN" ]; then
  glibc_max=$(ft::glibc_max "$FT_OUT/$FT_MAIN_BIN")
  elf_arch=$(readelf -h "$FT_OUT/$FT_MAIN_BIN" 2>/dev/null | awk '/Machine:/{print $2}')
  needed_libs=$(readelf -d "$FT_OUT/$FT_MAIN_BIN" 2>/dev/null \
    | grep -oE 'Shared library: \[[^]]+\]' | sed 's/.*\[\(.*\)\]/\1/' | paste -sd, -)
fi

# ---- meta ------------------------------------------------------------------
export M_TOOL_ID="$id" M_TOOL_VERSION="${FT_TOOL_VERSION:-unknown}" M_TOOL_KIND="${FT_TOOL_KIND:-binary}"
export M_MAIN_BIN="${FT_MAIN_BIN:-}" M_GLIBC_MAX="$glibc_max" M_ELF_ARCH="$elf_arch" M_NEEDED="$needed_libs"
export M_VERSION_OUTPUT="$ver_out" M_UPSTREAM_URL="${FT_UPSTREAM_URL:-}" M_UPSTREAM_NOTE="${FT_UPSTREAM_NOTE:-}"
export M_BUILD_TS="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
python3 "$FT_SRC/builders/make_meta.py" "$FT_TOOL_DIR" || ft::die "meta generation failed"

if [ -f "$FT_TOOL_DIR/UNAVAILABLE" ]; then
  ft::log "build UNAVAILABLE (recorded, not failed): $id"
else
  ft::note build_status SUCCESS
  ft::log "build OK: $id ${FT_TOOL_VERSION} glibc_max=${glibc_max:-n/a}"
fi
