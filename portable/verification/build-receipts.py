#!/usr/bin/env python3
"""Convert build/verify evidence streams into machine-readable receipts.

Usage: build-receipts.py <out_dir> <status_dir> [repo_root]
  out_dir     = FT_OUT on the build server (receipts/, logs/, tools/, evidence/, packages/)
  status_dir  = destination (repo portable/status/) — receipts/ + PORTABLE_RUNTIME.json + SUMMARY.md
  repo_root   = repo copy on server (registry/PROBLEM_CAPABILITIES.json, .deploy-head)
"""
import datetime, glob, hashlib, json, os, sys

out_dir, status_dir = sys.argv[1], sys.argv[2]
repo_root = sys.argv[3] if len(sys.argv) > 3 else None
os.makedirs(os.path.join(status_dir, "receipts"), exist_ok=True)


def read_events(path):
    data = {"downloads": []}
    if not os.path.isfile(path):
        return data
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            parts = line.rstrip("\n").split("\t", 1)
            if len(parts) != 2:
                continue
            k, v = parts
            if k == "download_url":
                data["downloads"].append({"url": v})
            elif k == "download_sha256" and data["downloads"]:
                data["downloads"][-1]["sha256"] = v
            elif k == "sha_verified" and data["downloads"]:
                data["downloads"][-1]["sha_verified"] = v
            else:
                data[k] = v
    return data


def tail(path, n=40):
    if not os.path.isfile(path):
        return []
    return open(path, encoding="utf-8", errors="replace").read().splitlines()[-n:]


def parse_verify_tsv(path):
    res = {"verdict": "UNKNOWN", "phases": {}, "skip": False}
    if not os.path.isfile(path):
        return None
    for line in open(path, encoding="utf-8"):
        c = line.rstrip("\n").split("\t")
        if len(c) >= 2 and c[0] == "verdict":
            res["verdict"] = c[1]
            if c[1] == "SKIP":
                res["skip"] = True
        elif len(c) >= 7 and c[0] == "id":
            continue
        elif len(c) >= 7:
            res["phases"][c[1]] = {
                "exit": int(c[2]), "duration_ms": int(c[3]),
                "output_matched": c[4] == "1", "exit_ok": c[5] == "1", "label": c[6],
            }
    return res


tool_ids = sorted(os.path.basename(p)[6:-7] for p in glob.glob(os.path.join(out_dir, "receipts", "build-*.events")))
builds, verifies = {}, {}
for tid in tool_ids:
    ev = read_events(os.path.join(out_dir, "receipts", f"build-{tid}.events"))
    meta_p = os.path.join(out_dir, "tools", tid, "meta.json")
    meta = {}
    if os.path.isfile(meta_p):
        meta = json.load(open(meta_p, encoding="utf-8"))
    pkg = None
    pkg_matches = sorted(glob.glob(os.path.join(out_dir, "packages", "tools", f"{tid}-*-linux-x86_64.tar.zst")))
    if pkg_matches:
        pkg = pkg_matches[-1]
    build = {
        "tool_id": tid,
        "status": ev.get("build_status", "NOT_RUN"),
        "failure_reason": ev.get("failure_reason"),
        "version": meta.get("version") or ev.get("requested_version"),
        "kind": meta.get("kind"),
        "glibc_max": meta.get("glibc_max"),
        "elf_arch": meta.get("elf_arch"),
        "needed_libs": meta.get("needed_libs"),
        "version_output": meta.get("version_output"),
        "upstream": ev.get("downloads") or None,
        "build_ts": meta.get("build_ts"),
        "log_tail": tail(os.path.join(out_dir, "logs", f"{tid}.build.log")),
    }
    if pkg and os.path.isfile(pkg):
        h = hashlib.sha256(open(pkg, "rb").read()).hexdigest()
        build["package"] = {"path": "packages/tools/" + os.path.basename(pkg), "sha256": h}
    builds[tid] = build
    json.dump(build, open(os.path.join(status_dir, "receipts", f"build-{tid}.json"), "w", encoding="utf-8"),
              indent=2, ensure_ascii=False)

    v = parse_verify_tsv(os.path.join(out_dir, "evidence", f"verify-{tid}.tsv"))
    if v:
        v["tool_id"] = tid
        verifies[tid] = v
        json.dump(v, open(os.path.join(status_dir, "receipts", f"verify-{tid}.json"), "w", encoding="utf-8"),
                  indent=2, ensure_ascii=False)

# ---- authoritative 36-tool list from the repo registry ----------------------
registry_tools = []
reg_path = os.path.join(repo_root, "registry", "PROBLEM_CAPABILITIES.json") if repo_root else None
if reg_path and os.path.isfile(reg_path):
    reg = json.load(open(reg_path, encoding="utf-8"))
    registry_tools = [
        {"id": t["id"], "capability_ids": t.get("capability_ids", []), "official_url": t.get("official_url")}
        for t in reg.get("tools", [])
    ]

all_ids = sorted({t["id"] for t in registry_tools} | set(tool_ids))


def status_of(tid):
    b = builds.get(tid)
    if not b:
        return "NOT_BUILT", None
    st = b["status"]
    if st == "SUCCESS":
        return "PACKAGED", None
    if st == "UNAVAILABLE":
        return "UNAVAILABLE", b.get("failure_reason")
    return "BUILD_FAILED", b.get("failure_reason") or (b["log_tail"][-1] if b["log_tail"] else None)


tools_out = []
for t in registry_tools:
    tid = t["id"]
    avail, reason = status_of(tid)
    v = verifies.get(tid)
    tools_out.append({
        **t,
        "portable_availability": avail,
        "runtime_verified": bool(v and v.get("verdict") == "PASS"),
        "verify_verdict": v.get("verdict") if v else "NOT_VERIFIED",
        "version": (builds.get(tid) or {}).get("version"),
        "blocker_reason": reason,
    })
# any built id not present in registry (drift guard)
extra = [tid for tid in tool_ids if tid not in {t["id"] for t in registry_tools}]
for tid in extra:
    avail, reason = status_of(tid)
    v = verifies.get(tid)
    tools_out.append({"id": tid, "capability_ids": [], "official_url": None, "portable_availability": avail,
                      "runtime_verified": bool(v and v.get("verdict") == "PASS"), "verify_verdict": v.get("verdict") if v else "NOT_VERIFIED",
                      "version": (builds.get(tid) or {}).get("version"), "blocker_reason": reason})

head = None
if repo_root:
    for cand in (os.path.join(repo_root, "portable", ".deploy-head"),):
        if os.path.isfile(cand):
            head = open(cand, encoding="utf-8").read().strip()

doc = {
    "schema": "formal-tools/portable-runtime/0.1",
    "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
    "source_head": head,
    "target": {"os": "debian-13", "os_codename": "trixie", "arch": "x86_64", "glibc_max": "2.41"},
    "runtimes": {"python": "3.13.5", "node": "22.16.0", "java": "21.0.13+9 Temurin JRE"},
    "registry_reference": "registry/PROBLEM_CAPABILITIES.json",
    "availability_states": ["PACKAGED", "UNAVAILABLE", "BUILD_FAILED", "NOT_BUILT"],
    "tools": tools_out,
}
json.dump(doc, open(os.path.join(status_dir, "PORTABLE_RUNTIME.json"), "w", encoding="utf-8"),
          indent=2, ensure_ascii=False)

ok_build = sum(1 for t in tools_out if t["portable_availability"] == "PACKAGED")
ok_verify = sum(1 for t in tools_out if t["runtime_verified"])
unavail = [t["id"] for t in tools_out if t["portable_availability"] == "UNAVAILABLE"]
failed = [t["id"] for t in tools_out if t["portable_availability"] == "BUILD_FAILED"]
lines = [
    "# Portable Runtime Build Summary (Debian 13 x86_64)",
    "",
    f"Generated: {doc['generated_at']}  ·  source HEAD: `{head or 'unknown'}`",
    f"Target: Debian 13 (trixie) x86_64, glibc <= 2.41 · runtimes: Python 3.13.5 / Node 22.16.0 / Java 21.0.13+9",
    "",
    "| metric | count |",
    "|---|---|",
    f"| tools registered | {len(tools_out)} |",
    f"| build PACKAGED | {ok_build} |",
    f"| runtime_verified PASS | {ok_verify} |",
    f"| BUILD_FAILED | {len(failed)} ({', '.join(failed) or '-'}) |",
    f"| UNAVAILABLE | {len(unavail)} ({', '.join(unavail) or '-'}) |",
    "",
    "| tool | availability | version | verify | blocker |",
    "|---|---|---|---|---|",
]
for t in sorted(tools_out, key=lambda x: x["id"]):
    lines.append(f"| {t['id']} | {t['portable_availability']} | {t.get('version') or '-'} "
                 f"| {t['verify_verdict']} | {t.get('blocker_reason') or '-'} |")
lines += ["", "Per-tool receipts: receipts/build-<id>.json, receipts/verify-<id>.json."]
open(os.path.join(status_dir, "SUMMARY.md"), "w", encoding="utf-8").write("\n".join(lines) + "\n")
print(f"receipts: {len(tool_ids)} builds, {len(verifies)} verifies; "
      f"PACKAGED={ok_build} VERIFY_PASS={ok_verify} FAILED={len(failed)} UNAVAILABLE={len(unavail)}")
