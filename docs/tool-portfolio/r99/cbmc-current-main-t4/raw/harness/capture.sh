#!/bin/bash
# CBMC current-main T4 R104 capture session.
# Runs inside ft-node:deb13 (Debian 13 trixie, node v22.23.5) as --user 65534:65534
# with mounts: /w/repo (b9a662f tree, ro), /w/bundle (overlay bundle, ro),
# /w/cap (capture outputs, rw), /w/harness (hook+driver, ro).
set -u
REPO=/w/repo
BUNDLE=/w/bundle
CAP=/w/cap
HOOK=/w/harness/hook.cjs
DRIVER=/w/harness/sdk-driver.mjs
RUNNER_SHA=60af447ecfbc401549a7bbaab56e4111e0ca1d66a19bdc81e9eb479bdcd26c71
META_SHA=f09b83bf3b6c1f8c4a586fa76dc7f759deedcc0dc0d50bb7e8902ed2f0748d76
FIXTURE_SHA=f31f8f4fa90d6645c5d0a73bf9ec019e9a9cca9f04e1681f83af09513cf6282f
WRONG_SHA=0000000000000000000000000000000000000000000000000000000000000000

umask 022
mkdir -p "$CAP/raw" "$CAP/receipts/cli-verify" "$CAP/receipts/sdk-verify" \
  "$CAP/runner-doctor" "$CAP/runner-version" "$CAP/runner-native" "$CAP/runner-verify"

cap() { # name argv... -> raw/<name>.stdout/.stderr/.exit
  local name="$1"; shift
  "$@" >"$CAP/raw/$name.stdout" 2>"$CAP/raw/$name.stderr"
  echo $? >"$CAP/raw/$name.exit"
}

# Session identity + provenance record
{
  echo "cwd=$REPO"
  id
  uname -a
  cat /etc/os-release | head -2
  node --version
  echo "FORMAL_PORTABLE_ROOT=$BUNDLE"
  echo "FORMAL_PORTABLE_RUNNER_SHA256=$RUNNER_SHA"
  echo "FORMAL_PORTABLE_META_SHA256=$META_SHA"
  echo "FORMAL_PORTABLE_FIXTURE_SHA256=$FIXTURE_SHA"
  echo "FORMAL_PORTABLE_RUNNER_SHA256_WRONGPIN=$WRONG_SHA"
} >"$CAP/raw/session.txt" 2>&1

export FORMAL_PORTABLE_ROOT="$BUNDLE"
export FORMAL_PORTABLE_RUNNER_SHA256="$RUNNER_SHA"
export FORMAL_PORTABLE_META_SHA256="$META_SHA"
export FORMAL_PORTABLE_FIXTURE_SHA256="$FIXTURE_SHA"

# ---- direct Runner receipts (exact current-main Runner blob 40427c1) --------
cap runner-doctor  env FT_EVIDENCE_DIR="$CAP/runner-doctor"  "$BUNDLE/bin/tool-runner" doctor cbmc
cap runner-version env FT_EVIDENCE_DIR="$CAP/runner-version" "$BUNDLE/bin/tool-runner" version cbmc
cap runner-native  env FT_EVIDENCE_DIR="$CAP/runner-native"  "$BUNDLE/bin/tool-runner" run cbmc --version
cap runner-verify  env FT_EVIDENCE_DIR="$CAP/runner-verify"  "$BUNDLE/bin/tool-runner" verify cbmc

# ---- CLI (exact current-main cli.mjs blob 05a0693) --------------------------
cap cli-inspect    node "$REPO/packages/runner/js/cli.mjs" portfolio inspect cbmc
cap cli-doctor     node "$REPO/packages/runner/js/cli.mjs" portfolio doctor cbmc
cap cli-verify     env FT_RECEIPT_CAPTURE_DIR="$CAP/receipts/cli-verify" \
                   node --require "$HOOK" "$REPO/packages/runner/js/cli.mjs" portfolio verify cbmc
cap cli-wrong-pin  env FORMAL_PORTABLE_RUNNER_SHA256="$WRONG_SHA" \
                   node "$REPO/packages/runner/js/cli.mjs" portfolio verify cbmc

# ---- SDK (exact current-main sdk.mjs blob 774899d via driver) ---------------
cap sdk-doctor     node "$DRIVER" doctor "$REPO/packages/runner/js/sdk.mjs"
cap sdk-verify     env FT_RECEIPT_CAPTURE_DIR="$CAP/receipts/sdk-verify" \
                   node --require "$HOOK" "$DRIVER" verify "$REPO/packages/runner/js/sdk.mjs"
cap sdk-wrong-pin  env FORMAL_PORTABLE_RUNNER_SHA256="$WRONG_SHA" \
                   node "$DRIVER" verify "$REPO/packages/runner/js/sdk.mjs"

# ---- MCP local attempt without node_modules (offline contract record) ------
cap mcp-no-deps    node "$REPO/packages/runner/js/mcp.mjs"
# (mcp.mjs reserves stdout for the protocol; without deps the import fails.)

# ---- Inventory --------------------------------------------------------------
( cd "$CAP" && find . -type f | LC_ALL=C sort | xargs sha256sum ) >"$CAP/raw/capture-SHA256SUMS" 2>&1
echo CAPTURE_DONE
