# I11 R109 C — finite Solution / first-party Consumer Contract

Issue \`kaicreator-mm/formal-tools#170\` (Product #11), C-exclusive write set.

## Independent, deterministic semantic reference

The frozen local Source \`benchmarks/llm-methods/i11/r109/c/graph-source.json\`
defines a **four-node finite directed, weighted graph** with non-negative costs.
A new local finite Dijkstra solver produces distance **7**, path
\`a → b → c → d\`. A **separate source file** \`independent-oracle.mjs\`
enumerates **all simple paths**, independently obtaining the minimum distance
7. Neither algorithm calls the other. Oracle and Source exact bytes are
separately SHA256-pinned; tool source, model and evidence are separately pinned.
All five source edges, node ordering, version and scope are fixed in code;
caller-supplied graph or "oracle verdict" values never authorize admission.

\`QUALIFIED_WITH_SCOPE\` means **only** that this one fixed, fully local,
read-only finite graph result passed an independent deterministic reference
under a checked first-party implementation. It is **not** an external
professional Oracle, Production Product approval, external runtime trust
anchor, G4 Candidate promotion, G3 solver rerun, external Effect or Release.
The production \`G4_QUALIFICATION_ANCHORS.json\` stays
\`NOT_CONFIGURED\` with empty anchors; existing Candidate Store paths,
\`CANDIDATE / NOT_ADMITTED\`, historical receipts and negative-only G6 tests
remain unchanged.

## First-party JS SDK and standalone CLI

SDK: \`packages/runner/js/i11-scoped-solution.mjs\` exports
\`admitScopedSolution\`, \`consumeScopedSolution\`,
\`revokeScopedSolution\` and \`observeLocalScopedEvidence\`.

CLI: \`node packages/runner/js/i11-scoped-solution-cli.mjs admit DIR\`,
\`consume DIR SOLUTION_ID NONCE LOCAL_FINITE_GRAPH_READ_ONLY\`, or
\`revoke DIR SOLUTION_ID\`.

The caller provisions an **owner-local absolute POSIX** store directory;
records are content-addressed, bounded, atomically linked without replacement
and file/directory fsync'ed. A revocation tombstone is durable and cannot be
cleared through these APIs. Consumption is a local **read-only observation**,
with a fixed consumer label, fixed scope, current Source/Oracle/model/tool and
evidence digests, fixed version and expiry, bounded budget, and persistent
per-solution/per-nonce replay markers. Multiple distinct nonces may reuse the
same local answer; replay of a used nonce is rejected. Concurrent use of an
identical nonce admits **at most one** observation. UNKNOWN/ERROR/TIMEOUT and
all non-PROVEN outcomes are non-authorizing. There is **zero external Effect**.

Trust boundary: the local owner/process and repository files are assumed
trusted; the CLI consumer label is **not remote identity authentication**.
The mutable owner-local directory is not a malicious multi-tenant Host.
Any statement of \`QUALIFIED_WITH_SCOPE\` is confined to this test fixture.
A party who controls the Node process/repository source or the store owner can
modify its own local truth; this is not a signature-based professional
attestation. Fail-closed checks defend caller-input drift, corrupt record,
version mismatch, revoke and nonce replay within the defined local boundary.

## Gates

\`tests/i11-r109-scoped-solution-consumer.test.mjs\` covers a real local
positive path, independent semantic Oracle agreement, JS SDK and CLI consumer
acceptance, source/Oracle/model/tool/version/evidence drift, scope and extra
authorization fields, expired solution, UNKNOWN/ERROR/TIMEOUT, exhausted
budget, durable tamper/revocation/no-resurrection, concurrent duplicate nonce
and untouched old Candidate fail-closed. Must pass on Node >=24 at exact
new PR HEAD in Woodpecker Push and PR, followed by **other-conversation,
non-Writer** P0/P1/P2 Source-First review. This document is an engineering
claim and test contract, not that review or CI success.

Only this new first-party self-contained C scope can become
\`QUALIFIED_WITH_SCOPE\`; all other previous Candidates remain
\`NOT_ADMITTED\` until separate genuine authority/evidence is supplied.
No \`domain-harness\`, DIS, Tally Host, or external Product CI is a
dependency of #11.
