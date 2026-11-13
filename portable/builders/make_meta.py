#!/usr/bin/env python3
"""Write meta.json (and meta.sh) for a built tool from M_* env vars. Usage: make_meta.py <tool_dir>"""
import json, os, shlex, sys


def die(msg, code=1):
    print("make_meta: FAIL-CLOSED: %s" % msg, file=sys.stderr)
    sys.exit(code)


if len(sys.argv) != 2 or not sys.argv[1]:
    die("usage: make_meta.py <tool_dir>", 2)
tool_dir = sys.argv[1]
if not os.path.isdir(tool_dir):
    die("tool_dir is not a directory: %s" % tool_dir)


def req(name):
    v = os.environ.get(name)
    if v is None or not v.strip():
        die("required env %s is empty or unset (caller: builders/build-tool.sh)" % name)
    return v


def opt(name):
    return os.environ.get(name) or None


fields = {
    "tool_id": req("M_TOOL_ID"),
    "version": req("M_TOOL_VERSION"),
    "kind": req("M_TOOL_KIND"),
    "main_bin": opt("M_MAIN_BIN"),
    "glibc_max": opt("M_GLIBC_MAX"),
    "elf_arch": opt("M_ELF_ARCH"),
    "needed_libs": opt("M_NEEDED"),
    "version_output": opt("M_VERSION_OUTPUT"),
    "upstream_url": opt("M_UPSTREAM_URL"),
    "upstream_note": opt("M_UPSTREAM_NOTE"),
    "build_ts": req("M_BUILD_TS"),
    "builder_image": "ft-builder:deb13",
    "target": {"os": "debian-13", "arch": "x86_64", "glibc_max": "2.41"},
    "unavailable": os.environ.get("M_UNAVAILABLE") == "1",
    "unavailable_reason": opt("M_REASON"),
}
if fields["unavailable"] and not fields["unavailable_reason"]:
    die("M_UNAVAILABLE=1 requires a non-empty M_REASON (recorded in meta, never silent)")

meta_json = os.path.join(tool_dir, "meta.json")
with open(meta_json, "w", encoding="utf-8") as f:
    json.dump(fields, f, indent=2, ensure_ascii=False)
meta_sh = os.path.join(tool_dir, "meta.sh")
# meta.sh contract: bin/tool-runner (tool_meta) and packaging/pack.sh consume these
# TOOL_-prefixed names. TOOL_ID is the single non-uniform key — NOT TOOL_TOOL_ID
# (the R2 recovery r2-fix-meta-core.sh had to sed-repair deployed bundles for
# exactly that double-prefix bug; evidence: deployed bundle tools/*/meta.sh).
with open(meta_sh, "w", encoding="utf-8") as f:
    for k, name in (
        ("tool_id", "TOOL_ID"),
        ("version", "TOOL_VERSION"),
        ("kind", "TOOL_KIND"),
        ("main_bin", "TOOL_MAIN_BIN"),
        ("glibc_max", "TOOL_GLIBC_MAX"),
        ("elf_arch", "TOOL_ELF_ARCH"),
    ):
        f.write("%s=%s\n" % (name, shlex.quote(fields[k] or "")))
    f.write("UNAVAILABLE=%s\n" % ("1" if fields["unavailable"] else "0"))
print("meta written:", meta_json)
