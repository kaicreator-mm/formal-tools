#!/usr/bin/env python3
"""One-off: convert in-function FT_TOOL_VERSION assignments to ft::set_version()."""
import glob, re

# python-lib specs: importlib pattern → ft::set_version
pat = re.compile(r'FT_TOOL_VERSION=\(\$PY')
for f in glob.glob("*.sh"):
    s = open(f, encoding="utf-8").read()
    s2 = pat.sub('ft::set_version ($PY', s)
    if s2 != s:
        open(f, "w", encoding="utf-8", newline="\n").write(s2)
        print("converted (importlib):", f)

# individual in-function assignments
subs = {
    "fast-check.sh": ('[ "$pkg" = fast-check ] && FT_TOOL_VERSION="$ver"',
                      '[ "$pkg" = fast-check ] && ft::set_version "$ver"'),
    "kani.sh": ('[ -n "$v" ] && FT_TOOL_VERSION=$(printf \'%s\' "$v" | grep -oE \'[0-9]+\\.[0-9]+\\.[0-9]+\' | head -1)',
                '[ -n "$v" ] && ft::set_version $(printf \'%s\' "$v" | grep -oE \'[0-9]+\\.[0-9]+\\.[0-9]+\' | head -1)'),
    "tla-tlc.sh": ('  FT_TOOL_VERSION=$ver',
                   '  ft::set_version "$ver" || ver="github-latest"'),
    "storm.sh": ('  [ -f "$stage/env" ] && . "$stage/env" && [ -n "${STORM_VERSION:-}" ] && FT_TOOL_VERSION="$STORM_VERSION"',
                 '  [ -f "$stage/env" ] && . "$stage/env" && [ -n "${STORM_VERSION:-}" ] && ft::set_version "$STORM_VERSION"'),
}
for f, (old, new) in subs.items():
    s = open(f, encoding="utf-8").read()
    if old in s:
        open(f, "w", encoding="utf-8", newline="\n").write(s.replace(old, new, 1))
        print("converted:", f)
    elif new in s:
        print("already:", f)
    else:
        print("PATTERN MISS:", f)

# apache-jena: candidate-loop version assignment
s = open("apache-jena.sh", encoding="utf-8").read()
s2 = s.replace('      FT_TOOL_VERSION="$ver"', '      ft::set_version "$ver" || true')
s2 = s2.replace('[ -n "${tgz:-}" ]', 'if [ -z "${FT_TOOL_VERSION:-}" ]; then ft::set_version "5.5.0"; fi\n  [ -n "${tgz:-}" ]')
if s2 != s:
    open("apache-jena.sh", "w", encoding="utf-8", newline="\n").write(s2)
    print("converted: apache-jena.sh")
