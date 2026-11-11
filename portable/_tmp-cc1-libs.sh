#!/bin/sh
# One-off: copy cc1's shared-lib closure into kani's lib dir (root-side).
set -e
CC1=$(ls /k/gccroot/lib/gcc/x86_64-linux-gnu/*/cc1 | head -1)
echo "CC1=$CC1"
ldd "$CC1" 2>/dev/null | awk '/=> \//{print $3}' | while read -r so; do
  case "$so" in
    */libc.so*|*/libm.so*|*/ld-linux*|*/libpthread*|*/libdl*|*/librt*) continue ;;
  esac
  cp -Ln "$so" /k/lib/ 2>/dev/null || true
  echo "copied $(basename "$so")"
done
chmod -R a+rX /k/lib /k/gccroot /k/run
echo LIBS_DONE
