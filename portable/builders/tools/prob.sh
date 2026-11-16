# builders/tools/prob.sh — ProB model checker 1.16.1 (SICStus full distribution from HHU).
# Channel: stups.hhu-hosting.de/downloads/prob/tcltk/releases/1.16.1/ProB.linux64.tar.gz
# (direct, no form). The tcltk full distribution INCLUDES lib/probcliparser.jar and a
# valid SICStus runtime — unlike the slim cli zips (no parser jar) and the old
# models/Reals/ProB_SICStus4.10_RealFloatSolver tar (expired time-limited SICStus).
FT_TOOL_ID=prob
FT_TOOL_VERSION=1.16.1
FT_TOOL_KIND=java-bundle
FT_MAIN_BIN=""
FT_UPSTREAM_URL="https://stups.hhu-hosting.de/downloads/prob/tcltk/releases/1.16.1/ProB.linux64.tar.gz"
FT_PROBE=(probcli -version)

ft_tool_build() {
  local f
  f=$(ft::fetch "$FT_UPSTREAM_URL") || ft::unavailable "ProB.linux64.tar.gz unreachable at stups.hhu-hosting.de"
  # The official archive's SHA256 is NOT independently pinned here. The
  # historical Drive .tar.zst hash is for a different derived package.
  ft::note "upstream_archive_sha256_attestation" "UNVERIFIED_OFFICIAL_TAR_GZ"
  # Use a per-invocation staging root to prevent a stale /tmp/ProB source
  # directory from being silently selected on a subsequent builder run.
  local work_dir src
  work_dir=$(mktemp -d /tmp/ft-prob-source.XXXXXXXX) || ft::die "ProB staging creation failed"
  # The driver invokes ft_tool_build in a dedicated subshell; EXIT also runs
  # on ft::die and keeps a failed build from leaving reusable source contents.
  trap "rm -rf -- '$work_dir'" EXIT
  ft::extract "$f" "$work_dir" || ft::die "ProB source extraction failed"
  src="$work_dir/ProB"
  [ -L "$src" ] && ft::die "ProB source root symlink is forbidden"
  [ -d "$src" ] || ft::die "ProB dir not found in tarball"
  # Require the extracted top-level directory to be a real directory directly
  # beneath our private stage, not a symlink to an external source tree.
  local stage_real source_real
  stage_real=$(cd -P -- "$work_dir" && pwd -P) || ft::die "ProB staging root cannot be resolved"
  source_real=$(cd -P -- "$src" && pwd -P) || ft::die "ProB source root cannot be resolved"
  [ "$source_real" = "$stage_real/ProB" ] || ft::die "ProB source root escapes private staging"
  cp -a "$src/." "$FT_TOOL_DIR/" || ft::die "ProB payload copy failed"
  find "$FT_TOOL_DIR" -maxdepth 2 -type f -name 'probcli' -exec chmod +x {} + 2>/dev/null || true
  [ -f "$FT_TOOL_DIR/lib/probcliparser.jar" ] || ft::die "probcliparser.jar missing (incomplete distribution)"
  [ -x "$FT_TOOL_DIR/probcli" ] || ft::die "probcli executable missing"
  local v
  v=$(cd "$FT_TOOL_DIR" && ./probcli -version 2>&1) || ft::die "ProB version probe failed"
  # A diagnostic merely mentioning 1.16.1-final must never certify the
  # executable. Refuse ambiguous multi-line banners and match one complete
  # product/version record, with an optional exact 40-hex source commit.
  local version_line_count
  version_line_count=$(printf '%s\n' "$v" | wc -l | tr -d '[:space:]')
  [ "$version_line_count" = "1" ] || ft::die "ProB version probe returned ambiguous output"
  printf '%s\n' "$v" | grep -Eq '^ProB version 1[.]16[.]1-final( \\([a-f0-9]{40}\\))?$' \
    || ft::die "ProB binary version is not 1.16.1-final"
  ft::note "prob_version_line" "$v"
  ft::make_shim 'export JAVA_HOME="$FT_ROOT/runtimes/java21"
export PATH="$JAVA_HOME/bin:$TOOL_DIR:$PATH"
export PROB_HOME="$TOOL_DIR"
export LD_LIBRARY_PATH="$TOOL_DIR/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec "$TOOL_DIR/probcli" "$@"'
}
