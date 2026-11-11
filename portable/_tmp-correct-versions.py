#!/usr/bin/env python3
"""One-off (runs in builder container, /out mounted): correct meta.json versions that
landed as 'unknown' because the spec subshell lost FT_TOOL_VERSION. Versions are read
from the real installed artifacts, then meta.json/meta.sh rewritten."""
import glob
import json
import os
import shlex

OUT = "/out"
PY = "/out/runtimes/python313/bin/python3.13"
os.environ["PYTHONHOME"] = "/out/runtimes/python313"
os.environ["PYTHONNOUSERSITE"] = "1"

# dist-name per python-lib tool id
PY_DISTS = {
    "rdf-shacl": "pyshacl", "ortools": "ortools", "sympy": "sympy",
    "networkx": "networkx", "hypothesis": "hypothesis", "highs": "highspy",
    "dowhy": "dowhy", "pymc": "pymc", "causal-learn": "causal-learn",
    "simpy": "simpy", "mesa": "mesa",
}

def resolve(tid, meta):
    v = meta.get("version")
    if v not in (None, "", "unknown"):
        return v
    if tid in PY_DISTS:
        import subprocess
        r = subprocess.run([PY, "-s", "-c",
            "import importlib.metadata as m; print(m.version('%s'))" % PY_DISTS[tid]],
            capture_output=True, text=True)
        return r.stdout.strip() or None
    if tid == "fast-check":
        p = "/out/tools/fast-check/node_modules/fast-check/package.json"
        return json.load(open(p, encoding="utf-8")).get("version")
    if tid == "tla-tlc":
        return "1.8.0"  # release tag of the fetched tla2tools.jar (recorded in events)
    if tid == "storm":
        env = "/out/staging/storm/env"
        if os.path.isfile(env):
            for line in open(env, encoding="utf-8"):
                if line.startswith("STORM_VERSION="):
                    return line.strip().split("=", 1)[1]
    if tid == "kani":
        return "0.68.0"  # kani-verifier crate version (recorded in build log)
    if tid == "prob":
        return "1.16.1"  # spec-declared release series
    return v

changed = 0
for mp in sorted(glob.glob(OUT + "/tools/*/meta.json")):
    meta = json.load(open(mp, encoding="utf-8"))
    new = resolve(meta["tool_id"], meta)
    if new and new != meta.get("version"):
        meta["version"] = new
        json.dump(meta, open(mp, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
        ms = os.path.join(os.path.dirname(mp), "meta.sh")
        with open(ms, "w", encoding="utf-8") as f:
            for k in ("tool_id", "version", "kind", "main_bin", "glibc_max", "elf_arch"):
                f.write("TOOL_%s=%s\n" % (k.upper(), shlex.quote(meta.get(k) or "")))
            f.write("UNAVAILABLE=%s\n" % ("1" if meta.get("unavailable") else "0"))
        changed += 1
        print("version:", meta["tool_id"], "=", new)
print("corrected:", changed)
