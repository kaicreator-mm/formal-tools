# formal-tools-portable (Debian 13 x86_64)

Self-contained tool bundle: 36 formal/logical/optimization/simulation tools plus shared
runtimes (Python 3.13.5, Node.js 22.16.0, Temurin JRE 21.0.13+9). Extract anywhere and run —
no installation, no network access required.

## Quick start

```sh
./bin/tool-runner list              # all tools with version/kind
./bin/tool-runner doctor all        # binary deps (ldd), arch, runtime checks
./bin/tool-runner run z3 model.smt2 # run any tool entry point
./bin/tool-runner py  script.py     # bundled Python
./bin/tool-runner node script.mjs   # bundled Node.js
./bin/tool-runner java -jar x.jar   # bundled Java
./bin/tool-runner verify all        # replay positive/negative/invalid-input cases
```

Verification writes receipts to `evidence/` (override with `FT_EVIDENCE_DIR=<writable dir>`).

## Layout

- `bin/tool-runner` — unified entry point (bash, no external deps beyond coreutils)
- `tools/<id>/` — per-tool payload + `run` shim + `meta.json` (version, glibc_max, ELF audit)
- `runtimes/` — python313 (use via `tool-runner py`; PYTHONHOME is set for you), node22, java21
- `tests/<id>/` — positive/negative/invalid-input cases + `expect.sh` judgment contract
- `registry/` — capability registry cross-reference (from the formal-tools repo)
- `evidence/` — build + verification receipts (also mirrored in the repo under portable/status/)
- `manifest.json` — machine-readable manifest: tool versions, target, python package list

## Requirements

- Linux x86_64, glibc <= 2.41 (Debian 13 / trixie is the reference target; anything with
  glibc >= recorded per-tool `glibc_max` works)
- coreutils + bash; each tool additionally only needs its own bundled dependencies
- Known path-locked exception: why3 resolves its driver directory via `WHY3DATA` (set by its
  shim) — works at any extraction path; `nuXmv` is not bundled (license-gated upstream).
