#!/usr/bin/env python3
"""Write meta.json (and meta.sh) for a built tool from M_* env vars. Usage: make_meta.py <tool_dir>"""
import json, os, shlex, sys

tool_dir = sys.argv[1]
fields = {
    "tool_id": os.environ["M_TOOL_ID"],
    "version": os.environ["M_TOOL_VERSION"],
    "kind": os.environ["M_TOOL_KIND"],
    "main_bin": os.environ["M_MAIN_BIN"],
    "glibc_max": os.environ["M_GLIBC_MAX"] or None,
    "elf_arch": os.environ["M_ELF_ARCH"] or None,
    "needed_libs": os.environ["M_NEEDED"] or None,
    "version_output": os.environ["M_VERSION_OUTPUT"] or None,
    "upstream_url": os.environ["M_UPSTREAM_URL"] or None,
    "upstream_note": os.environ["M_UPSTREAM_NOTE"] or None,
    "build_ts": os.environ["M_BUILD_TS"],
    "builder_image": "ft-builder:deb13",
    "target": {"os": "debian-13", "arch": "x86_64", "glibc_max": "2.41"},
    "unavailable": os.environ.get("M_UNAVAILABLE") == "1",
    "unavailable_reason": os.environ.get("M_REASON") or None,
}
meta_json = os.path.join(tool_dir, "meta.json")
with open(meta_json, "w", encoding="utf-8") as f:
    json.dump(fields, f, indent=2, ensure_ascii=False)
meta_sh = os.path.join(tool_dir, "meta.sh")
with open(meta_sh, "w", encoding="utf-8") as f:
    for k in ("tool_id", "version", "kind", "main_bin", "glibc_max", "elf_arch"):
        f.write("%s=%s\n" % (k.upper(), shlex.quote(fields[k] or "")))
    f.write("UNAVAILABLE=%s\n" % ("1" if fields["unavailable"] else "0"))
print("meta written:", meta_json)
