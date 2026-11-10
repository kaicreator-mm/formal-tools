# R1 isolated lane: generated artifact inventory (tool-level only)

**Implementation ownership**: `dev/r1-artifact-inventory-lane`, separate from PR #9's Tool Manager / native Runner / SDK write set. No changes to shared Runner or existing CLI/MCP yet.

## Purpose

Formal/logic tools can write traces, logs, state files, proof certificates, model outputs and other data. Today R1 PR #9's experimental SDK reports `artifacts.status=NOT_COLLECTED`. This lane provides a **generic, bounded, read-only inventory** of files created/changed by upstream tools. It does not interpret models, business semantics, or simulate anything.

File: `packages/runner/js/artifact-collector.mjs`.

```js
import {
  scanArtifactWorkspace, collectGeneratedArtifacts
} from "./packages/runner/js/artifact-collector.mjs";

const before = await scanArtifactWorkspace(privateWorkspace);
// caller invokes upstream tool in that same private workspace
const generated = await collectGeneratedArtifacts(privateWorkspace,before,{
  maxFiles:256, maxBytes:16*1024*1024, maxDepth:8
});
console.log(generated.status,generated.items);
```

Exports:

- `scanArtifactWorkspace(workspace,limits)` produces a sorted, relative-path-only SHA-256 inventory, without opening symlink targets.
- `artifactDelta(baseline,postRunScan)` computes newly added / SHA-changed files without assigning proof semantics. It is **pure JS**, independent of filesystem or Node tooling.
- `collectGeneratedArtifacts(workspace,baseline,limits)` is a convenience wrapper.

### Guardrails and honest limits

- Caller **must own a private, temporary workspace** and must prepare any necessary source files. The scanner never creates or cleans the workspace or launches tools.
- Scan only regular files; skip symlink roots, symlink files, directory symlinks, nonregular entries; verify path containment. Files are hashed in streaming reads.
- Bound recursion depth, file count and bytes hashed. Overflow/unreadable/changed entries produce `PARTIAL` and explicit reasons, not a false claim of completeness.
- Do not return absolute filesystem paths or inline the original artifact bytes, only metadata and SHA-256.
- **Not an OS sandbox**: other processes can race against filesystem scanning; directory reparse points and adversarial filesystem mutation require host-level isolation and separate execution controls.
- This is tool *artifact metadata*, **not** a validated result about any project or business domain.
- No automatic wiring to PR #9 until its Writer has completed Node/native validation and the integration ownership transfers. A later integration can stage input files, run the tool, inventory generated artifacts, and attach the manifest to the technical SDK result.

### Tests / acceptance

`node --test tests/artifact-collector.test.mjs` runs temporary-workspace tests: hash correctness, new/modified/unchanged outputs, file/byte/depth caps, symlink behavior (skipped on Windows systems without link permission), root symlink rejection and path validation.

**CI/native state**: authoring an executable test file does not mean it ran. Restricted-JS unit checks apply only to the pure `artifactDelta` function; Node filesystem tests and integration with 13 native tools remain `NOT_RUN` until independently executed at the PR's exact HEAD.
