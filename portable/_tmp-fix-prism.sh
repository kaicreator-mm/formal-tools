#!/usr/bin/env bash
# One-off: relocalize PRISM_DIR in the deployed prism launcher (root-side, in container).
set -e
python3 - <<'PYEOF'
import re
p = "/p/bin/prism"
s = open(p, encoding="utf-8").read()
new = 'PRISM_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"'
s2, n = re.subn(r'^PRISM_DIR=.*$', new, s, count=1, flags=re.M)
open(p, "w", encoding="utf-8").write(s2)
print("PRISM_DIR lines replaced:", n)
PYEOF
chmod a+rX /p/bin/prism
grep -m1 '^PRISM_DIR=' /p/bin/prism
