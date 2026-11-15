# builders/tools/fast-downward.sh — Fast Downward classical planner (pinned official source build).
FT_TOOL_ID=fast-downward
FT_TOOL_VERSION=24.06
FT_TOOL_KIND=bundle
FT_MAIN_BIN=""
FT_UPSTREAM_TAG=release-24.06.0
FT_UPSTREAM_COMMIT=113fe1a626176f0c34888c645d4c25e7c31db372
FT_UPSTREAM_GIT_URL="https://github.com/aibasel/downward.git"
FT_UPSTREAM_URL="https://github.com/aibasel/downward/tree/$FT_UPSTREAM_TAG"
FT_UPSTREAM_NOTE="source_tag=$FT_UPSTREAM_TAG;source_commit=$FT_UPSTREAM_COMMIT"
FT_PROBE=(run --version)

ft_tool_build() {
  local src="/tmp/fdx/downward"
  rm -rf /tmp/fdx
  mkdir -p /tmp/fdx

  # The release tag is immutable and the resolved commit is checked below.
  # Never build from the moving upstream main branch or infer a commit from a tarball hash.
  if ! git clone --depth 1 --branch "$FT_UPSTREAM_TAG" --single-branch \
      "$FT_UPSTREAM_GIT_URL" "$src" >>"$FT_LOG" 2>&1; then
    ft::unavailable "official Fast Downward source tag could not be fetched: $FT_UPSTREAM_TAG"
  fi

  local commit tree
  commit=$(git -C "$src" rev-parse HEAD 2>/dev/null) || ft::die "could not resolve Fast Downward source commit"
  [ "$commit" = "$FT_UPSTREAM_COMMIT" ] || \
    ft::die "Fast Downward source commit mismatch: got=$commit expected=$FT_UPSTREAM_COMMIT"
  tree=$(git -C "$src" rev-parse 'HEAD^{tree}' 2>/dev/null) || \
    ft::die "could not resolve Fast Downward source tree"

  ft::note downward_source_tag "$FT_UPSTREAM_TAG"
  ft::note downward_source_ref "$commit"
  ft::note downward_source_tree "$tree"

  [ -f "$src/driver/version.py" ] || ft::die "Fast Downward version.py missing"
  grep -Fxq '__version__ = "24.06"' "$src/driver/version.py" || \
    ft::die "Fast Downward source version.py does not match declared 24.06"

  ( cd "$src" && python3 build.py release >>"$FT_LOG" 2>&1 ) || \
    ft::die "downward build.py failed"

  local revision_header="$src/builds/release/search/git_revision.h"
  [ -f "$revision_header" ] || ft::die "Fast Downward git_revision.h missing after build"
  grep -Fq "$FT_UPSTREAM_COMMIT" "$revision_header" || \
    ft::die "Fast Downward binary source revision is not pinned to $FT_UPSTREAM_COMMIT"

  [ -x "$src/builds/release/bin/downward" ] || ft::die "downward binary missing after build"
  cp -a "$src" "$FT_TOOL_DIR/payload"

  ft::make_shim 'export PATH="$TOOL_DIR/payload/builds/release/bin:$PATH"
exec "$FT_ROOT/runtimes/python313/bin/python3.13" -s "$TOOL_DIR/payload/fast-downward.py" --build=release "$@"'

  local version_output
  version_output=$(cd "$FT_TOOL_DIR" && ./run --version 2>&1) || \
    ft::die "Fast Downward packaged run --version failed"
  printf '%s\n' "$version_output" | grep -Fq "Fast Downward $FT_TOOL_VERSION" || \
    ft::die "Fast Downward packaged version mismatch: $version_output"
  ft::note downward_version_output "$version_output"
}
