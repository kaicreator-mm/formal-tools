#!/usr/bin/env bash
# R2 tasks 2-4 (server): per-tool independent offline verification.
# One fresh container per tool (ft-builder:deb13 has zstd; --network none; per-class
# cpu/mem limits). Verdicts come ONLY from the runner TSV (runner_schema 0.2 fail-closed).
# Split archives (>128MiB, .part-NN): stage B rejoins inside the container.
set -uo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=../env.sh
source "$HERE/env.sh"

PKG="$FT_PKG_DIR"
BUNDLE_HOST="$FT_EV_DIR/r2/unpack"
EV="$FT_EV_DIR/r2"
IMG="ft-builder:deb13"
mkdir -p "$EV"

res_for() {
  case "$1" in
    lean4|kani|storm|apalache)  echo "4 12 900" ;;
    fast-downward|ortools)      echo "4 8 600" ;;
    pymc|prob|dafny|why3|robot|minizinc|prism) echo "3 6 600" ;;
    *)                          echo "2 4 300" ;;
  esac
}

extract_one() { # container-internal helper: extract one archive (file or split parts)
  local path=$1 dest=$2
  mkdir -p "/u/$(dirname "$path")"
  if [ -f "$path" ]; then
    tar --zstd -xf "$path" -C "$dest" 2>> /u/unpack-errors.log || { echo "UNPACK FAIL: $path" >> /u/unpack-errors.log; return 1; }
  elif [ -f "$path.part-00" ]; then
    cat "$path".part-?? | tar --zstd -xf - -C "$dest" 2>> /u/unpack-errors.log || { echo "UNPACK FAIL(split): $path" >> /u/unpack-errors.log; return 1; }
  else
    echo "MISSING: $path" >> /u/unpack-errors.log
    return 1
  fi
  return 0
}

# ---- stage A: per-archive integrity (sha + zstd -t), own container per archive ----
echo "stageA: archive integrity (per-archive container)"
: > "$EV/stageA-archive.tsv"
cd "$PKG"
while read -r hash path; do
  path=${path#\./}
  parts=$(ls "$path".part-?? 2>/dev/null | wc -l)
  if [ "$parts" -gt 0 ]; then
    cat "$path".part-?? > /tmp/r2-rejoin.tar.zst
    zt=$(zstd -t /tmp/r2-rejoin.tar.zst >/dev/null 2>&1 && echo OK || echo BAD)
    sha_now=$(sha256sum /tmp/r2-rejoin.tar.zst | cut -d' ' -f1)
    sha_ok=$([ "$sha_now" = "$hash" ] && echo OK || echo BAD)
    rm -f /tmp/r2-rejoin.tar.zst
  else
    [ -f "$path" ] || continue
    zt=$(docker run --rm --network none -v "/home/cc/formal-tools-build/out/packages:/pkg:ro" \
          "$IMG" zstd -t "/pkg/$path" >/dev/null 2>&1 && echo OK || echo BAD)
    sha_ok=$(echo "$hash  $path" | sha256sum -c --quiet >/dev/null 2>&1 && echo OK || echo BAD)
  fi
  echo -e "$path\tsha=$sha_ok\tzstd=$zt" >> "$EV/stageA-archive.tsv"
  echo "  $path sha=$sha_ok zstd=$zt"
done < SHA256SUMS

# ---- stage B: batch unpack in ONE container (reproduce reported failure) ----------
echo "stageB: batch unpack (single container, limits 4cpu/8g)"
mkdir -p "$FT_EV_DIR/r2/unpack"
docker run --rm --network none --cpus 4 --memory 8g \
  -v "$PKG:/pkg:ro" -v "$FT_EV_DIR/r2/unpack:/u" \
  "$IMG" bash -c '
    set -o pipefail
    cd /pkg
    sha256sum -c SHA256SUMS > /u/unpack-sha.log 2>&1; echo "sha_rc=$?" >> /u/unpack-sha.log
    err=0
    extract_one() {
      local path=$1
      mkdir -p "/u/$(dirname "$path")"
      if [ -f "$path" ]; then
        tar --zstd -xf "$path" -C /u 2>> /u/unpack-errors.log || { echo "UNPACK FAIL: $path" >> /u/unpack-errors.log; return 1; }
      elif [ -f "$path.part-00" ]; then
        cat "$path".part-?? | tar --zstd -xf - -C /u 2>> /u/unpack-errors.log || { echo "UNPACK FAIL(split): $path" >> /u/unpack-errors.log; return 1; }
      else
        echo "MISSING: $path" >> /u/unpack-errors.log
        return 1
      fi
      return 0
    }
    while read -r hash path; do
      path=${path#\./}
      case "$path" in
        *.tar.zst) extract_one "$path" || err=1 ;;
      esac
    done < SHA256SUMS
    echo "BATCH_ERR=$err" >> /u/unpack-sha.log
    echo BATCH_DONE' > "$EV/stageB.log" 2>&1
grep -E "sha_rc|BATCH_ERR" "$EV/stageB.log" || true
head -8 "$EV/unpack/unpack-errors.log" 2>/dev/null || true

[ -x "$BUNDLE_HOST/bin/tool-runner" ] || { echo "FATAL: bundle tree missing after stage B"; exit 1; }

# ---- stage C: per-tool verification (fresh container each, against unpacked tree) --
# why3: pre-clean the ft-builder baked ocaml dir so the shim symlink works
TOOLS="aflpp alloy apache-jena apalache causal-learn cbmc clingo cvc5 dafny dowhy elk fast-check fast-downward highs hypothesis kani lean4 mesa minizinc networkx nuxmv ortools prism prob pymc rdf-shacl robot simpy souffle storm sympy tla-tlc tree-sitter vampire why3 z3"
PASS=0; FAIL=0; NOTRUN=0
: > "$EV/stageC-tools.tsv"
for t in $TOOLS; do
  read -r cpu mem tmo <<< "$(res_for "$t")"
  mkdir -p "$EV/$t"
  echo ">> $t (cpu=$cpu mem=${mem}g case_timeout=120s)"
  pre=""
  if [ "$t" = "why3" ]; then
    pre="rm -rf /usr/lib/x86_64-linux-gnu/ocaml 2>/dev/null; mkdir -p /usr/lib/x86_64-linux-gnu/ocaml; ln -sfn /bundle/tools/why3/usr/lib/x86_64-linux-gnu/ocaml/5.3.0 /usr/lib/x86_64-linux-gnu/ocaml/5.3.0 2>/dev/null || true;"
  fi
  timeout $((tmo + 90)) docker run --rm --network none --cpus "$cpu" --memory "${mem}g" \
    -v "$BUNDLE_HOST:/bundle:ro" \
    -v "$EV/$t:/ev" -e FT_EVIDENCE_DIR=/ev -e HOME=/tmp \
    "$IMG" bash -c "
      $pre
      echo '== doctor ==';   /bundle/bin/tool-runner doctor $t 2>&1
      echo '== version ==';  /bundle/bin/tool-runner version $t 2>&1 | head -3
      echo '== cases ==';    /bundle/bin/tool-runner verify $t 2>&1
      echo RUNNER_RC=\$?
    " > "$EV/$t/session.log" 2>&1
  tsv="$EV/verify-$t.tsv"
  verdict=FAIL; schema=absent
  if [ -f "$tsv" ]; then
    schema=$(awk -F'\t' '$1=="runner_schema"{print $2}' "$tsv" | tail -1)
    verdict=$(awk -F'\t' '$1=="verdict"{print $2}' "$tsv" | tail -1)
  else
    verdict=NOT_RUN
  fi
  case "$verdict" in
    PASS) PASS=$((PASS+1));;
    SKIP) NOTRUN=$((NOTRUN+1));;
    *)    FAIL=$((FAIL+1));;
  esac
  echo -e "$t\t$verdict\tschema=$schema" >> "$EV/stageC-tools.tsv"
  echo "   $t -> $verdict"
done
echo "totals: PASS=$PASS FAIL=$FAIL NOT_RUN=$NOTRUN"
echo "LOOP_DONE"
