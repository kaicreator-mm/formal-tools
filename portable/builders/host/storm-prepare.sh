#!/usr/bin/env bash
# portable/builders/host/storm-prepare.sh — runs on the DOCKER HOST (build server).
# Layout-agnostic extraction of the official Storm image payload:
#   - locate the dir containing the `storm` binary (works for /opt/storm and /usr/local layouts)
#   - export <prefix>/bin -> staging/payload/bin, <prefix>/lib -> staging/payload/lib
#   - copy the shared-lib closure of every storm binary into staging/libs
set -uo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=../../env.sh
source "$HERE/../env.sh"
mkdir -p "$FT_OUT/staging"
STAGE="$FT_OUT/staging/storm"
rm -rf "$STAGE"; mkdir -p "$STAGE"

IMG_SRC="docker.m.daocloud.io/movesrwth/storm:stable"
IMG="movesrwth/storm:stable"
if ! docker image inspect "$IMG" >/dev/null 2>&1; then
  docker pull -q "$IMG_SRC" || { echo "FATAL: storm image pull failed"; exit 3; }
  docker tag "$IMG_SRC" "$IMG"
fi

# locate storm binary paths inside the image
STORM_BIN=$(docker run --rm --entrypoint /bin/sh "$IMG" -c 'for d in /usr/local/bin /usr/bin /opt/storm/bin /opt/storm/inner/bin; do [ -x "$d/storm" ] && echo "$d/storm" && break; done')
[ -n "${STORM_BIN:-}" ] || { echo "FATAL: storm binary not found in image"; exit 3; }
PREFIX=$(dirname "$STORM_BIN"); PREFIX=${PREFIX%/bin}
echo "storm prefix in image: $PREFIX"

CID=$(docker create "$IMG")
trap 'docker rm -f "$CID" >/dev/null 2>&1 || true' EXIT

mkdir -p "$STAGE/payload/bin" "$STAGE/payload/lib"
docker export "$CID" | tar -xf - -C "$STAGE/payload" "$PREFIX/bin" "$PREFIX/lib" 2>/dev/null || true
if [ ! -f "$STAGE/payload/$PREFIX/bin/storm" ]; then
  echo "FATAL: export did not yield $PREFIX/bin/storm"; exit 3
fi
# normalize to payload/bin, payload/lib
mv "$STAGE/payload/$PREFIX/bin/." "$STAGE/payload/bin/" 2>/dev/null || true
mv "$STAGE/payload/$PREFIX/lib/." "$STAGE/payload/lib/" 2>/dev/null || true
rm -rf "$STAGE/payload/$PREFIX"

# shared-lib closure for all storm ELF binaries, via the image's own ldd
mkdir -p "$STAGE/libs"
docker run --rm --entrypoint /bin/sh -v "$STAGE:/stage" "$IMG" -c '
  for f in /usr/local/bin/storm* /usr/bin/storm* /opt/storm/bin/* ; do
    [ -x "$f" ] || continue
    ldd "$f" 2>/dev/null | awk "/=> \//{print \$3}"
  done | sort -u' > "$STAGE/so-list.txt" || true
while IFS= read -r so; do
  [ -n "$so" ] || continue
  case "$so" in
    */libc.so*|*/libm.so*|*/ld-linux*|*/libpthread*|*/libdl*|*/librt*|*/libstdc*|*/libgcc_s*) continue ;;
  esac
  base=$(basename "$so")
  docker run --rm --entrypoint /bin/sh -v "$STAGE:/stage" "$IMG" -c "cp -L '$so' '/stage/libs/$base'" || true
done < "$STAGE/so-list.txt"
rm -f "$STAGE/so-list.txt"

V=$(docker run --rm --entrypoint /bin/sh "$IMG" -c '/usr/local/bin/storm --version 2>/dev/null | head -1 || true')
echo "storm version line: $V"
printf 'STORM_VERSION=%s\n' "$(printf '%s' "$V" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)" > "$STAGE/env"
echo "staged: bin=$(ls "$STAGE/payload/bin" | wc -l) payload_lib=$(ls "$STAGE/payload/lib" 2>/dev/null | wc -l) closure_libs=$(ls "$STAGE/libs" | wc -l)"
echo "storm staging OK"
