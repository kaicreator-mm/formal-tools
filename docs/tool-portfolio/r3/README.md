# Lean4 4.35.0 — 5-part transport checkpoint (2026-11-13)

**Authority:** [Tool Issue #41](https://github.com/kaicreator-mm/formal-tools/issues/41) → [Tool Portfolio #24](https://github.com/kaicreator-mm/formal-tools/issues/24) → [Product #11](https://github.com/kaicreator-mm/formal-tools/issues/11).

Source folder: [Google Drive App/packages/tools](https://drive.google.com/drive/folders/1rIJ315fjiXtJEPk9mjXP2Kzty4V3n3nZ). The original **567,187,865-byte** Lean4 tar.zst remains there; it exceeds the prior 268,435,456-byte connector download ceiling. A new set of five individually downloadable consecutive raw segments (.part-00 through .part-04) was uploaded to that folder.

## What was actually established

- Provider metadata confirms part-00–part-03 each exactly **134,217,728 bytes** and part-04 **30,316,953 bytes**, total **567,187,865 bytes**.
- All five per-part Google Drive raw-file streaming fetch calls succeeded with the expected file size. The bytes were materialized under /mnt/data in the ChatGPT environment, but **no local execution tool could start** (container shell, Python and independent Python execution repeatedly returned ClientError).
- The original App/packages/SHA256SUMS entry is **671b172f8dacc4a7fd405852a2286e7657ec8c4414d301a73ece6f98f39bde62**. This is the **expected** hash, not a reconstructed-file result. No individual part hash was published in the source SHA manifest at this checkpoint.
- **Reassembly, actual source SHA match, zstd integrity, safe tar preflight, extraction, tool-runner doctor and native positive/negative/invalid Lean proof execution are all NOT_RUN.** Do not mark Lean4 ENV_PASS merely for size/inventory or these JS tests.

## Reassemble on a healthy host (strict, SHA-pinned)

Download all five named source parts into one directory; do not rename their .part-XX suffixes. They are consecutive raw archive bytes, not separate zstd-compressed tar files. From the repo root:

~~~sh
node scripts/reassemble-lean4-chunks.mjs --parts-dir /path/to/parts --output /path/to/lean4-4.35.0-linux-x86_64.tar.zst
zstd -t /path/to/lean4-4.35.0-linux-x86_64.tar.zst
~~~

- Reassembly streams fixed part order and sizes, checks real full SHA256 against source, refuses overwriting an output, removes unverified temporary outputs, and reports REASSEMBLED_SHA256_MATCH_ONLY. It does **not** extract or execute.
- The next mandatory safety gate inspects every tar member before extraction, rejects absolute/traversal/device/escaping symlink entries and oversized uncompressed output, extracts only inside an isolated unprivileged directory, then executes the same SHA-bound core Runner doctor / verify lean4 with bounded CPU/RAM/time; records actual positive, negative, invalid stdout/stderr, exit, hashes and source identities; and submits for independent scoped review.
- Do not edit original archives or PR #22 Writer-owned source in this docs PR. No automatic Project G3/Oracle/Release qualification.

## Offline static regression

~~~sh
node --test tests/lean4-chunks.test.mjs
npm run formal:test
~~~

These synthetic stream-reassembly tests validate the implementation and pinned manifest only, **not** Lean4 4.35.0 native execution.
