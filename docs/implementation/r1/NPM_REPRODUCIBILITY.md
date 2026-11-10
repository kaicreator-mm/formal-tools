# R1 M03 — npm workspace dependency reproducibility

Authority: [Issue #14](https://github.com/kaicreator-mm/formal-tools/issues/14), post-closure maintenance of [Issue #7](https://github.com/kaicreator-mm/formal-tools/issues/7).

## Source-confirmed baseline

- Root `package.json` declares private npm workspaces `packages/core` and `packages/runner`, plus npm ranges for `@modelcontextprotocol/server`, `zod`, `typescript`, and `@types/node`.
- There is no checked-in root `package-lock.json` or `npm-shrinkwrap.json` as of `main@ad35fd2b38f67664c74316aed2b81a06fc150ec1`.
- The existing Woodpecker workflow previously ran `node --test tests/*.test.mjs` **before** `npm install`. On a persistent local-backend agent, a successful test before installation cannot prove that the current commit's declared dependencies were installed first.
- This PR's first incremental correction moves dependency preparation before all Node tests. **It does not complete M03**: npm install without a lockfile remains version-flexible.

## Final preferred strategy (requires real npm registry and one actual host acceptance run)

1. Use a clean checkout of the current PR branch and a supported Node/npm toolchain. From the **monorepo root**, let npm resolve the full workspace dependency graph and create a real root `package-lock.json` (do not hand-author integrity hashes or resolved tarball URLs). Do not change existing semver policy merely to manufacture a green result.
2. Verify that the lockfile covers the root **and both workspaces**; compare lockfile against source manifests. On a fresh checkout run `npm ci --ignore-scripts --no-audit --no-fund --prefer-offline` and check that it succeeds without mutating `package.json` or the lockfile. Test the same lock across the actual supported host/CI environment.
3. Once this passes, change Woodpecker's installation command from `npm install` to `npm ci`, **before** `node --test`. Preserve mandatory `npm run typecheck` and all existing CLI smoke checks. Reproducibility requires verified `npm ci`, not just adding a lockfile while leaving `npm install` in the CI script.
4. Capture exact source SHA, Node/npm versions, lockfile diff, clean install stdout/stderr and exit codes, 91+ affected Node tests, TypeScript checks, CLI smoke and both push / PR Woodpecker contexts. Repair real failures in the same PR; require source review and final Exact-SHA green gates before merging.
5. If a reproducibility strategy must be rejected, document actual npm error/root cause and explicit risk acceptance with evidence. Do not weaken TypeScript checks or make unrelated packages public.

## Acceptance and separation

- **Current interim state**: `M03=PARTIAL`; source CI order corrected, registry-generated lockfile + `npm ci` **NOT_RUN**. Do not mark this document as proof of a frozen dependency graph.
- This is a one-Writer maintenance branch. [Issue #7](https://github.com/kaicreator-mm/formal-tools/issues/7) remains `CLOSED/COMPLETED` at 12/12; native 13-engine/26-fixture acceptance stays Issue #4; new Method/Solution development stays Issue #11.
