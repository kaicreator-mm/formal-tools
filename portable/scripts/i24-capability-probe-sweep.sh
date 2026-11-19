#!/bin/bash
# i24-capability-probe-sweep.sh — ONE authoritative capability-probe sweep over the
# DEPLOYED portable bundle (container formal-tools:deb13-r0 on cc@192.168.100.200:2222).
#
# Reuse discipline: re-executes each tool's PROVEN verify fixtures (pos/neg/err from
# tests/<id>/expect.sh via bin/tool-runner verify <id>) and adds:
#   - best-effort live version probe (run shim --version / python import probe)
#   - full IO capture (TSV rows + pos/neg/err logs embedded per-tool receipt)
#
# Usage: bash i24-capability-probe-sweep.sh <bundle_root> <out_dir>
# Outputs: <out_dir>/<tool_id>/  (verify.tsv copy, pos/neg/err.log copies, probe.txt, receipt.json)
#          <out_dir>/SWEEP_SUMMARY.json + SHA256SUMS
set -uo pipefail

BUNDLE="${1:?bundle root required}"
OUT="${2:?out dir required}"
RUNNER="$BUNDLE/bin/tool-runner"
PY="$BUNDLE/runtimes/python313/bin/python3.13"
EV="$BUNDLE/evidence"
STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
mkdir -p "$OUT"

[ -x "$RUNNER" ] || { echo "runner missing: $RUNNER" >&2; exit 2; }
[ -x "$PY" ] || PY=python3

# python-lib tool id -> importable module name (11 python-lib tools)
mod_for() {
  case "$1" in
    causal-learn) echo causallearn ;;
    rdf-shacl)    echo pyshacl ;;
    highs)        echo highspy ;;
    *)            echo "$1" ;;
  esac
}

manifest_sha=$(sha256sum "$BUNDLE/manifest.json" 2>/dev/null | cut -d' ' -f1 || echo null)
runner_sha=$(sha256sum "$RUNNER" | cut -d' ' -f1)
uname_s=$(uname -sr 2>/dev/null || echo unknown)

echo "sweep start $STAMP bundle=$BUNDLE manifest_sha=$manifest_sha"

ids=()
for d in "$BUNDLE"/tools/*/; do
  [ -f "$d/meta.sh" ] || continue
  ids+=("$(basename "$d")")
done
ids=($(printf '%s\n' "${ids[@]}" | sort))

for id in "${ids[@]}"; do
  meta="$BUNDLE/tools/$id/meta.sh"
  ver=$(sed -n 's/^TOOL_VERSION=//p' "$meta" | head -1 | tr -d '"' )
  kind=$(sed -n 's/^TOOL_KIND=//p' "$meta" | head -1 | tr -d '"' )
  unavail=$(sed -n 's/^UNAVAILABLE=//p' "$meta" | head -1)
  tdir="$OUT/$id"; mkdir -p "$tdir"
  echo "=== $id kind=$kind meta_ver=$ver unavail=${unavail:-0}"

  if [ "${unavail:-0}" = "1" ]; then
    printf 'SKIP\tunavailable (meta UNAVAILABLE=1)\n' > "$tdir/verify.tsv"
  else
    # clean prior verify rows for THIS tool (TSV is append-mode; keep the sweep single-authoritative)
    rm -f "$EV/verify-$id.tsv" "$EV/verify-$id.pos.log" "$EV/verify-$id.neg.log" "$EV/verify-$id.err.log"
    ( cd "$BUNDLE" && "$RUNNER" verify "$id" ) > "$tdir/verify-console.txt" 2>&1
    vrc=$?
    echo "verify_rc=$vrc" >> "$tdir/verify-console.txt"
    [ -f "$EV/verify-$id.tsv" ] && cp "$EV/verify-$id.tsv" "$tdir/verify.tsv"
    for ph in pos neg err; do
      [ -f "$EV/verify-$id.$ph.log" ] && cp "$EV/verify-$id.$ph.log" "$tdir/$ph.log"
    done
  fi

  # best-effort live version probe
  : > "$tdir/probe.txt"
  if [ "${unavail:-0}" = "1" ]; then
    echo "status=NOT_PROBED_UNAVAILABLE" >> "$tdir/probe.txt"
  elif [ "$kind" = "python-lib" ]; then
    mod=$(mod_for "$id")
    echo "cmd=py import $mod" >> "$tdir/probe.txt"
    timeout 60 "$RUNNER" py -c "import $mod as m; print(getattr(m,'__version__','?'))" >> "$tdir/probe.txt" 2>&1
    echo "rc=$?" >> "$tdir/probe.txt"
  else
    echo "cmd=run $id --version" >> "$tdir/probe.txt"
    timeout 45 "$RUNNER" run "$id" --version >> "$tdir/probe.txt" 2>&1 | head -5
    rc=${PIPESTATUS[0]}
    echo "rc=$rc" >> "$tdir/probe.txt"
    if [ "$rc" = "124" ]; then echo "status=TIMEOUT" >> "$tdir/probe.txt"; fi
  fi

  "$PY" - "$id" "$tdir" "$ver" "$kind" "${unavail:-0}" "$STAMP" "$manifest_sha" "$runner_sha" "$uname_s" <<'PYEOF'
import json, hashlib, os, sys
tool_id, tdir, meta_ver, kind, unavail, stamp, msha, rsha, uname = sys.argv[1:10]
def rd(p):
    try:
        return open(p, encoding="utf-8", errors="replace").read()
    except OSError:
        return None
tsv = rd(os.path.join(tdir, "verify.tsv"))
rows, verdict = [], "SKIP" if tsv is None else None
if tsv:
    for ln in tsv.splitlines():
        parts = ln.split("\t")
        if parts[0] == "verdict":
            verdict = parts[1]
        elif parts and parts[0] not in ("id", "verdict_all"):
            rows.append(parts)
probe = rd(os.path.join(tdir, "probe.txt")) or ""
probe_status = "NOT_PROBED_UNAVAILABLE" if unavail == "1" else (
    "TIMEOUT" if "status=TIMEOUT" in probe else "PROBED")
first = ""
for ln in probe.splitlines():
    if ln.startswith(("cmd=", "status=")):
        continue
    if ln.strip():
        first = ln.strip()[:200]
        break
receipt = {
    "schema": "formal-tools/capability-probe-receipt/0.1",
    "tool_id": tool_id,
    "meta_version": meta_ver or None,
    "kind": kind or None,
    "unavailable_flag": unavail,
    "verify": {"rows": rows, "verdict": verdict},
    "version_probe": {
        "status": probe_status,
        "probed_first_line": first or None,
        "raw": probe if len(probe) < 2000 else probe[:2000],
    },
    "logs": {ph: rd(os.path.join(tdir, ph + ".log")) for ph in ("pos", "neg", "err")},
    "environment": {
        "bundle_manifest_sha256": msha,
        "tool_runner_sha256": rsha,
        "uname": uname,
        "deployment": "docker formal-tools:deb13-r0 (container formal-tools-ssh, cc@192.168.100.200:2222)",
        "executed_at_utc": stamp,
    },
}
open(os.path.join(tdir, "receipt.json"), "w", encoding="utf-8").write(
    json.dumps(receipt, indent=1, ensure_ascii=False))
PYEOF
done

# sweep summary + integrity
"$PY" - "$OUT" "$STAMP" "$manifest_sha" "$runner_sha" <<'PYEOF'
import json, os, sys
out, stamp, msha, rsha = sys.argv[1:5]
summary = {"schema": "formal-tools/capability-probe-sweep/0.1", "executed_at_utc": stamp,
           "bundle_manifest_sha256": msha, "tool_runner_sha256": rsha,
           "deployment": "docker formal-tools:deb13-r0 (container formal-tools-ssh)", "tools": {}}
for name in sorted(os.listdir(out)):
    rp = os.path.join(out, name, "receipt.json")
    if not os.path.isfile(rp):
        continue
    r = json.load(open(rp, encoding="utf-8"))
    summary["tools"][name] = {
        "verdict": r["verify"]["verdict"],
        "meta_version": r["meta_version"], "kind": r["kind"],
        "version_probe_status": r["version_probe"]["status"],
        "probed_first_line": r["version_probe"]["probed_first_line"],
    }
open(os.path.join(out, "SWEEP_SUMMARY.json"), "w", encoding="utf-8").write(
    json.dumps(summary, indent=1, ensure_ascii=False))
PYEOF

( cd "$OUT" && find . -type f | sort | xargs sha256sum > SHA256SUMS )
echo "sweep done: $(find "$OUT" -name receipt.json | wc -l) receipts -> $OUT"
