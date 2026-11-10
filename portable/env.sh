# portable/env.sh — shared configuration, sourced by orchestrate.sh (server-side) and deploy scripts.
# Layout on build server: /home/cc/formal-tools-build/{src,out,cache}
#   src/    = git archive of this repo (portable/ under src/portable)
#   out/    = per-tool payloads, bundle assembly, packages, evidence, logs
#   cache/  = download + pip cache (survives re-runs)

export FT_SRV_ROOT="${FT_SRV_ROOT:-/home/cc/formal-tools-build}"
export FT_REPO_ROOT="$FT_SRV_ROOT/src"                # repo root on server
export FT_SRC="$FT_REPO_ROOT/portable"                # this directory on the server
export FT_OUT="$FT_SRV_ROOT/out"
export FT_CACHE="$FT_SRV_ROOT/cache"
export FT_BUNDLE="$FT_OUT/bundle/formal-tools-portable-debian13-x86_64"
export FT_PKG_DIR="$FT_OUT/packages"
export FT_EV_DIR="$FT_OUT/evidence"

export FT_IMG="${FT_IMG:-ft-builder:deb13}"           # builder image (debian:13 + toolchains)
export FT_RT_IMG="${FT_RT_IMG:-debian:13}"            # runtime verification image
export FT_CONC="${FT_CONC:-3}"                        # parallel tool builds
export FT_TIMEOUT_S="${FT_VERIFY_TIMEOUT_S:-600}"     # default per-case verify timeout

# Registry cross-reference (authoritative 36-tool list lives in repo: registry/PROBLEM_CAPABILITIES.json)
export FT_TARGET_OS="debian-13"
export FT_TARGET_ARCH="x86_64"
export FT_TARGET_GLIBC_MAX="2.41"
