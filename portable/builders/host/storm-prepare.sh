#!/usr/bin/env bash
# portable/builders/host/storm-prepare.sh — runs on the DOCKER HOST (build server).
# Layout-agnostic extraction of the official Storm image payload. The export|tar and
# normalization run INSIDE a root container (tar preserves image ownership; a plain
# user on the host cannot traverse/rename those dirs).
set -uo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=../../env.sh
source "$HERE/../env.sh"
mkdir -p "$FT_OUT/staging"
STAGE="$FT_OUT/staging/storm"
rm -rf "$STAGE"; mkdir -p "$STAGE"

IMG_SRC="docker.m.daocloud.io/movesrwth/storm:1.8.0"
IMG="movesrwth/storm:1.8.0"
if ! docker image inspect "$IMG" >/dev/null 2>&1; then
  docker pull -q "$IMG_SRC" || { echo "FATAL: storm image pull failed"; exit 3; }
  docker tag "$IMG_SRC" "$IMG"
fi
# glibc ceiling guard: image base must be <= Debian 13 (2.41) or the payload cannot run here
IMG_GLIBC=$(docker run --rm --entrypoint /bin/sh "$IMG" -c 'ldd --version | head -1' | grep -oE '[0-9]+\.[0-9]+$')
echo "image glibc: $IMG_GLIBC"
if [ "$(printf '%s\n2.41\n' "$IMG_GLIBC" | sort -V | head -1)" != "$IMG_GLIBC" ]; then
  echo "FATAL: image glibc $IMG_GLIBC exceeds target ceiling 2.41"
  exit 3
fi

STORM_BIN=$(docker run --rm --entrypoint /bin/sh "$IMG" -c 'for d in /usr/local/bin /usr/bin /opt/storm/bin /opt/storm/inner/bin; do [ -x "$d/storm" ] && echo "$d/storm" && break; done')
[ -n "${STORM_BIN:-}" ] || { echo "FATAL: storm binary not found in image"; exit 3; }
PREFIX=$(dirname "$STORM_BIN"); PREFIX=${PREFIX%/bin}
echo "storm prefix in image: $PREFIX"
V=$(docker run --rm --entrypoint /bin/sh "$IMG" -c "$STORM_BIN --version 2>/dev/null | head -1 || true")
echo "storm version line: $V"

CID=$(docker create "$IMG")
trap 'docker rm -f "$CID" >/dev/null 2>&1 || true' EXIT

mkdir -p "$STAGE/payload"
MBIN="$PREFIX/bin"; MBIN=${MBIN#/}
MLIB="$PREFIX/lib"; MLIB=${MLIB#/}
# export + extract + normalize + open perms, all as root inside the builder image
if ! docker export "$CID" | docker run --rm -i \
      -v "$STAGE:/stage" -v "$FT_SRC/builders:/src-builders:ro" \
      "$FT_IMG" bash -c "
set -e
mkdir -p /stage/payload/bin /stage/payload/lib
tar -xf - -C /stage/payload '$MBIN' '$MLIB'
cp -a /stage/payload/'$MBIN'/. /stage/payload/bin/
cp -a /stage/payload/'$MLIB'/. /stage/payload/lib/ 2>/dev/null || true
rm -rf /stage/payload/usr
chmod -R a+rX /stage/payload
chown -R $(id -u):$(id -g) /stage/payload
[ -f /stage/payload/bin/storm ] || { echo 'FATAL: bin/storm missing after extraction'; exit 3; }
echo EXTRACT_OK
"; then
  echo "FATAL: storm payload extraction failed"
  exit 3
fi

# shared-lib closure for all storm ELF binaries, via the image's own ldd; plus the
# image's bundled solver trees (/opt/gurobi, /opt/mathsat5) which storm dlopen's at runtime
mkdir -p "$STAGE/libs"
docker run --rm --entrypoint /bin/sh -v "$STAGE:/stage" "$IMG" -c '
  for f in /usr/local/bin/storm* /usr/bin/storm* /opt/storm/bin/* ; do
    [ -x "$f" ] || continue
    ldd "$f" 2>/dev/null | awk "/=> \//{print \$3}"
  done | sort -u
  find /opt -name "*.so*" 2>/dev/null' > "$STAGE/so-list.txt" || true
while IFS= read -r so; do
  [ -n "$so" ] || continue
  case "$so" in
    */libc.so*|*/libm.so*|*/ld-linux*|*/libpthread*|*/libdl*|*/librt*|*/libstdc*|*/libgcc_s*) continue ;;
  esac
  base=$(basename "$so")
  # keep versioned sonames distinct (libgurobi.so.13 vs libgurobi.so.13.0.3)
  docker run --rm --entrypoint /bin/sh -v "$STAGE:/stage" "$IMG" -c "cp -L '$so' '/stage/libs/$base'" || true
done < "$STAGE/so-list.txt"
rm -f "$STAGE/so-list.txt"

printf 'STORM_VERSION=%s\n' "$(printf '%s' "$V" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)" > "$STAGE/env"
echo "staged: bin=$(ls "$STAGE/payload/bin" | wc -l) payload_lib=$(ls "$STAGE/payload/lib" 2>/dev/null | wc -l) closure_libs=$(ls "$STAGE/libs" | wc -l)"
echo "storm staging OK"
