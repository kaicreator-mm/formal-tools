# builders/tools/clingo.sh — clingo ASP solver (source build; release has no linux binary asset)
FT_TOOL_ID=clingo
FT_TOOL_VERSION=5.8.3
FT_TOOL_KIND=binary
FT_MAIN_BIN="tools/clingo/bin/clingo"
# Upstream v5.8.3 tag was independently resolved to this commit at source review.
# A commit-addressed archive avoids silently following a later retargeted tag.
# The archive itself still needs a separately verified SHA256 for full T1.
FT_UPSTREAM_COMMIT=2ef91640ed3355c3211e9995edecdb20b16b0e38
FT_UPSTREAM_URL="https://github.com/potassco/clingo/archive/${FT_UPSTREAM_COMMIT}.tar.gz"
FT_UPSTREAM_NOTE="clingo v5.8.3 tag resolved to commit ${FT_UPSTREAM_COMMIT}; source archive SHA256 not independently pinned"
FT_PROBE=(bin/clingo --version)

ft_tool_build() (
  # Scope all compilation inputs and outputs to one fresh invocation. The old
  # /tmp/clingox, /tmp/clingob and /tmp/clingoinst paths could retain a prior
  # successful source tree and silently replace the newly downloaded source.
  local work_dir source_dir build_dir install_dir tgz src candidates actual_version
  work_dir=$(mktemp -d /tmp/ft-clingo.XXXXXXXX) || ft::die "clingo private staging creation failed"
  trap 'rm -rf -- "$work_dir"' EXIT
  source_dir="$work_dir/source"
  build_dir="$work_dir/build"
  install_dir="$work_dir/install"
  mkdir -p "$source_dir" "$build_dir" "$install_dir" || ft::die "clingo private staging setup failed"

  tgz=$(ft::fetch "$FT_UPSTREAM_URL") || ft::die "clingo source download failed"
  ft::extract "$tgz" "$source_dir" || ft::die "clingo source extraction failed"

  # Fail closed on zero/multiple trees instead of find -print -quit selecting
  # an arbitrary old directory. Reject a newline in a source path too.
  candidates=$(find "$source_dir" -mindepth 1 -maxdepth 1 -type d -name 'clingo-*' -print) \
    || ft::die "clingo source discovery failed"
  [ -n "$candidates" ] || ft::die "clingo source dir not found in fresh stage"
  case "$candidates" in *$'\n'*) ft::die "clingo source dirs ambiguous in fresh stage" ;; esac
  src="$candidates"
  case "$src" in "$source_dir"/clingo-*) ;; *) ft::die "clingo source dir outside fresh stage" ;; esac
  [ ! -L "$src" ] || ft::die "clingo source root symlink rejected"
  [ -f "$src/libclingo/clingo.h" ] || ft::die "clingo source version header missing"
  grep -Fxq '#define CLINGO_VERSION "5.8.3"' "$src/libclingo/clingo.h" \
    || ft::die "clingo source version does not match v5.8.3"

  ft::note "upstream_tag" "v5.8.3"
  ft::note "upstream_resolved_commit" "$FT_UPSTREAM_COMMIT"
  ft::note "source_archive_sha256_attestation" "NOT_VERIFIED_COMMIT_ADDRESSED_ONLY"

  cmake -S "$src" -B "$build_dir" -DCMAKE_BUILD_TYPE=Release -DCLINGO_BUILD_APPS=ON >>"$FT_LOG" 2>&1 \
    || ft::die "clingo cmake configure failed"
  cmake --build "$build_dir" -j"$(nproc)" >>"$FT_LOG" 2>&1 || ft::die "clingo build failed"
  cmake --install "$build_dir" --prefix "$install_dir" >>"$FT_LOG" 2>&1 \
    || ft::die "clingo install failed"

  mkdir -p "$FT_TOOL_DIR/bin" "$FT_TOOL_DIR/lib"
  cp "$install_dir/bin/clingo" "$FT_TOOL_DIR/bin/clingo" || ft::die "clingo binary missing"
  cp -a "$install_dir"/lib/libclingo*.so* "$install_dir"/lib/libgringo*.so* "$install_dir"/lib/libpotassco*.so* \
    "$FT_TOOL_DIR/lib/" 2>/dev/null || true
  ft::copy_libs "$FT_TOOL_DIR/bin/clingo" "$FT_TOOL_DIR/lib" || true
  LD_LIBRARY_PATH="$FT_TOOL_DIR/lib" ft::copy_libs "$FT_TOOL_DIR/bin/clingo" "$FT_TOOL_DIR/lib" || true
  patchelf --set-rpath '$ORIGIN/../lib' "$FT_TOOL_DIR/bin/clingo" 2>/dev/null || true
  actual_version=$(LD_LIBRARY_PATH="$FT_TOOL_DIR/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
    "$FT_TOOL_DIR/bin/clingo" --version 2>&1) || ft::die "packaged clingo version probe failed"
  printf '%s\n' "$actual_version" | grep -Fxq "clingo version $FT_TOOL_VERSION" \
    || ft::die "packaged clingo version does not match $FT_TOOL_VERSION"
  ft::make_shim 'export LD_LIBRARY_PATH="$TOOL_DIR/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec "$TOOL_DIR/bin/clingo" "$@"'
)
