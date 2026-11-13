#!/usr/bin/env python3
"""Generate manifest.json for the assembled portable bundle. Usage: make-manifest.py <bundle_dir>"""
import hashlib, json, os, sys

bundle = sys.argv[1]
tools = []
tdir = os.path.join(bundle, "tools")
for tid in sorted(os.listdir(tdir)):
    mp = os.path.join(tdir, tid, "meta.json")
    if os.path.isfile(mp):
        with open(mp, encoding="utf-8") as f:
            tools.append(json.load(f))

def sha256(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()

pycache = os.path.join(bundle, "runtimes", "python313", "lib", "python3.13", "site-packages")
py_pkgs = sorted(os.listdir(pycache))[:400] if os.path.isdir(pycache) else []

manifest = {
    "schema": "formal-tools/portable-bundle/0.1",
    "target": {"os": "debian-13", "os_codename": "trixie", "arch": "x86_64", "glibc_max": "2.41"},
    "runtimes": {
        "python": "3.13.5",
        "node": "22.16.0",
        "java": "21.0.13+9 (Temurin JRE)",
    },
    "python_site_packages_installed": py_pkgs,
    "tools": tools,
}
with open(os.path.join(bundle, "manifest.json"), "w", encoding="utf-8") as f:
    json.dump(manifest, f, indent=2, ensure_ascii=False)
print("manifest.json:", len(tools), "tools;", len(py_pkgs), "python packages listed")
