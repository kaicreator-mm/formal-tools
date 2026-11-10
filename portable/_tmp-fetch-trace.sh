#!/usr/bin/env bash
# one-off trace of fetch() from build-runtimes.sh (runs inside ft-builder)
set -uo pipefail
LOG=/tmp/ft.log; touch "$LOG"
log() { printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; }
eval "$(sed -n '/^fetch() {/,/^}/p' /src/portable/builders/build-runtimes.sh)"
set -x
fetch https://www.python.org/ftp/python/3.13.5/Python-3.13.5.tgz
