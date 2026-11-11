#!/usr/bin/env python3
"""One-off: regenerate meta.sh (TOOL_-prefixed) from existing meta.json for all tools."""
import glob, json, os, shlex

for meta_json in sorted(glob.glob("/out/tools/*/meta.json")):
    d = json.load(open(meta_json, encoding="utf-8"))
    meta_sh = os.path.join(os.path.dirname(meta_json), "meta.sh")
    with open(meta_sh, "w", encoding="utf-8") as f:
        for k in ("tool_id", "version", "kind", "main_bin", "glibc_max", "elf_arch"):
            f.write("TOOL_%s=%s\n" % (k.upper(), shlex.quote(d.get(k) or "")))
        f.write("UNAVAILABLE=%s\n" % ("1" if d.get("unavailable") else "0"))
    print("regen", meta_sh)
