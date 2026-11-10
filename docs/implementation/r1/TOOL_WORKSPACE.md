# Private tool input staging (R1 independent Lane)

Tool execution needs a **caller-owned, private working directory**, not direct writes to arbitrary project input files. This module is an independent library; **PR #9's shared SDK/Runner is not edited** while the local Agent owns it.

`prepareToolWorkspace(sourceRoot, inputs, options)` reads explicit source-relative regular files and copies them to a newly-created temp directory. It rejects path traversal, symlink source roots/components/files, non-files, duplicate paths, and enforces maxFiles/maxDepth/maxBytes. It hashes bytes while copying and removes its temporary workspace on error. Callers **must cleanup** successful stages.

```js
const work = await prepareToolWorkspace(ownedSourceDir, ["models/example.smt2"]);
try {
  const before = await scanArtifactWorkspace(work.root);
  // Invoke the upstream tool in work.root (trusted local host; no shell).
  const delta = await collectGeneratedArtifacts(work.root,before);
  // delta contains only relative paths, sizes, SHA-256 hashes.
} finally {
  await work.cleanup();
}
```

This is **not** a secure sandbox for an adversarial process or an actively malicious source file tree. OS permissions, writable mounts, subprocess resource budgets, and concurrency policy are separate responsibilities of the trusted host. Input source paths and business/model semantics belong to the caller; formal-tools does not choose them.

`tests/tool-workspace.test.mjs` exercises paths, nested inputs, byte limits, root and child symlinks, file-copy digests, output delta and source preservation using temporary files. Node tests **NOT_RUN** until a host executes them at an exact SHA.

Integration with PR #9 can happen after local Agent releases the shared SDK/Runner write set. Do not mark its `artifacts` field collected until an actual after-run scan was performed successfully.
