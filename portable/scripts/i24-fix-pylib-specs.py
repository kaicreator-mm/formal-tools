#!/usr/bin/env python3
"""I24 P1-family repair: fix broken ft::set_version calls in python-lib specs.

Commit 3478ba5 replaced FT_TOOL_VERSION=$(...) with ft::set_version (...) —
dropping the command substitution. bash refuses to source the spec
(syntax error near unexpected token), ft_tool_build is never defined, and
every python-lib build dies rc=127 (silently under orchestrate's serial
batch, which discards stdout).

Fix: ft::set_version ("$PY" ...)  ->  ft::set_version "$("$PY" ...)"
"""
import glob
import sys

BAD = 'ft::set_version ("$PY" '
GOOD = 'ft::set_version "$("$PY" '
BAD_TAIL = '2>>"$FT_LOG") \\'
GOOD_TAIL = '2>>"$FT_LOG")" \\'

files = sorted(glob.glob("portable/builders/tools/*.sh"))
fixed, skipped = [], []
for path in files:
    with open(path, encoding="utf-8") as f:
        text = f.read()
    if BAD not in text:
        skipped.append(path)
        continue
    n_head = text.count(BAD)
    n_tail = text.count(BAD_TAIL)
    if n_head != 1 or n_tail != 1:
        print("ABORT: %s has head=%d tail=%d (expected 1/1)" % (path, n_head, n_tail))
        sys.exit(2)
    text = text.replace(BAD, GOOD).replace(BAD_TAIL, GOOD_TAIL)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    fixed.append(path)

print("fixed %d specs:" % len(fixed))
for p in fixed:
    print("  %s" % p)
print("clean (untouched): %d" % len(skipped))
