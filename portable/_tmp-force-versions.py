#!/usr/bin/env python3
"""One-off pass 2: force-correct stale (non-unknown) versions from real artifacts."""
import glob
import json
import os
import shlex

OUT = "/out"

def setv(mp, meta, new):
    meta["version"] = new
    json.dump(meta, open(mp, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
    ms = os.path.join(os.path.dirname(mp), "meta.sh")
    with open(ms, "w", encoding="utf-8") as f:
        for k in ("tool_id", "version", "kind", "main_bin", "glibc_max", "elf_arch"):
            f.write("TOOL_%s=%s\n" % (k.upper(), shlex.quote(meta.get(k) or "")))
        f.write("UNAVAILABLE=%s\n" % ("1" if meta.get("unavailable") else "0"))
    print("forced:", meta["tool_id"], "=", new)

for mp in sorted(glob.glob(OUT + "/tools/*/meta.json")):
    meta = json.load(open(mp, encoding="utf-8"))
    tid = meta["tool_id"]
    if tid == "fast-check":
        p = "/out/tools/fast-check/node_modules/fast-check/package.json"
        new = json.load(open(p, encoding="utf-8")).get("version")
        if new and new != meta.get("version"):
            setv(mp, meta, new)
    if tid == "storm":
        env = "/out/staging/storm/env"
        new = None
        if os.path.isfile(env):
            for line in open(env, encoding="utf-8"):
                if line.startswith("STORM_VERSION="):
                    new = line.strip().split("=", 1)[1]
        if new and new != meta.get("version"):
            setv(mp, meta, new)
