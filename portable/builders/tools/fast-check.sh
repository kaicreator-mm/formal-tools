# builders/tools/fast-check.sh — fast-check property testing library for JS (npm tarballs, offline layout).
FT_TOOL_ID=fast-check
FT_TOOL_VERSION=4.3.0
FT_TOOL_KIND=node-lib
FT_MAIN_BIN=""
FT_UPSTREAM_URL="resolved at build (registry.npmjs.org fast-check + pure-rand)"
FT_PROBE=()

ft_tool_build() {
  mkdir -p "$FT_TOOL_DIR/node_modules"
  for pkg in fast-check pure-rand; do
    local meta ver tgz
    meta=$(curl -fsSL --retry 3 "https://registry.npmjs.org/$pkg") || ft::die "npm registry unreachable for $pkg"
    ver=$(printf '%s' "$meta" | python3 -c 'import json,sys; print(json.load(sys.stdin)["dist-tags"]["latest"])')
    [ "$pkg" = fast-check ] && ft::set_version "$ver"
    tgz=$(ft::fetch "https://registry.npmjs.org/$pkg/-/$pkg-$ver.tgz")
    local want
    want=$(printf '%s' "$meta" | python3 -c 'import json,sys; print(json.load(sys.stdin)["versions"]["'"$ver"'"]["dist"]["shasum"])')
    local got; got=$(sha1sum "$tgz" | cut -d' ' -f1)
    [ "$got" = "$want" ] || ft::die "npm dist shasum mismatch for $pkg@$ver"
    ft::note sha_verified npm-dist-shasum
    mkdir -p "/tmp/npmx/$pkg"
    tar -xzf "$tgz" -C "/tmp/npmx/$pkg"
    cp -a "/tmp/npmx/$pkg/package" "$FT_TOOL_DIR/node_modules/$pkg"
  done
  ft::make_shim 'export PATH="$FT_ROOT/runtimes/node22/bin:$PATH"
exec "$FT_ROOT/runtimes/node22/bin/node" "$@"'
}
