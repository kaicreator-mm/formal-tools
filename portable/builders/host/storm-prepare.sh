#!/usr/bin/env bash
# portable/builders/host/storm-prepare.sh — runs on the DOCKER HOST (build server).
# Extracts the official Storm checker image payload + its shared-library closure into
# $FT_OUT/staging/storm/{payload,libs}; the in-container spec then relocates it.
# (Kept host-side deliberately: no docker socket mounted into builder containers.)
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
CID=$(docker create "$IMG")
trap 'docker rm -f "$CID" >/dev/null 2>&1 || true' EXIT

# locate storm install inside image (usually /opt/storm)
STORM_DIR=$(docker start -a "$CID" >/dev/null 2>&1; docker export "$CID" | tar -tf - 2>/dev/null | grep -m1 'opt/storm/bin/storm$' | xargs dirname 2>/dev/null | xargs dirname 2>/dev/null)
if [ -z "${STORM_DIR:-}" ]; then
  # fallback: search
  STORM_DIR=$(docker export "$CID" | tar -tf - 2>/dev/null | grep -E 'bin/storm(-dft)?$' | head -1 | xargs dirname | xargs dirname)
fi
[ -n "${STORM_DIR:-}" ] || { echo "FATAL: cannot locate storm dir in image"; exit 3; }
echo "storm dir in image: $STORM_DIR"

mkdir -p "$STAGE/payload"
docker export "$CID" | tar -xf - -C "$STAGE/payload" \
  "$STORM_DIR" $( [ -d /dev/null ] && true ) 2>/dev/null || true
# also grab z3 if the image ships a private copy
docker export "$CID" | tar -tf - 2>/dev/null | grep -E 'bin/z3$' | while read -r z; do
  docker export "$CID" | tar -xf - -C "$STAGE/payload" "$z" || true
done

# shared-library closure for every storm binary (host-side ldd via image's own tools)
mkdir -p "$STAGE/libs"
for b in $(find "$STAGE/payload" -type f -name 'storm*'); do
  docker run --rm --entrypoint /bin/sh -v "$STAGE:/stage" "$IMG" -c "
    for f in $b /opt/storm/bin/*; do
      [ -x \$f ] || continue
      ldd \$f 2>/dev/null | awk '/=> \//{print \$3} /^\\//{print \$1}'
    done | sort -u" >> "$STAGE/so-list.txt" || true
done
sort -u "$STAGE/so-list.txt" 2>/dev/null | while read -r so; do
  case "$so" in
    */libc.so*|*/libm.so*|*/ld-linux*|*/libpthread*|*/libdl*|*/librt*) continue ;;
  esac
  base=$(basename "$so")
  docker run --rm --entrypoint /bin/sh -v "$STAGE:/stage" "$IMG" -c "cp -L '$so' /stage/libs/'$base'" || true
done
rm -f "$STAGE/so-list.txt"
echo "staged payload: $(find "$STAGE/payload" -type f | wc -l) files; libs: $(ls "$STAGE/libs" 2>/dev/null | wc -l)"
[ -f "$STAGE/payload/$STORM_DIR/bin/storm" ] || { echo "FATAL: storm binary missing after extraction"; exit 3; }
echo "STORM_DIR=$STORM_DIR" > "$STAGE/env"
echo "storm staging OK"
