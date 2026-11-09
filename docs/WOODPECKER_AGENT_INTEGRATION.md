# Formal Tools in Woodpecker CI Agent — feasibility and design

## Decision

**YES** for inclusion in the Woodpecker Agent's *execution environment*, through an ordinary Pipeline Step first, then optionally a reusable Woodpecker Plugin image. **NO** to changing/bundling all solvers into the native woodpecker-agent binary.

Official Woodpecker 3.18 agent architecture: the server schedules, the agent connects via gRPC and uses the Docker/Kubernetes/Local backend to execute workflow steps. Agent ≠ an LLM Agent. A separate ChatGPT or LLM Agent can invoke the shared formal runner through MCP, but Woodpecker itself needs only a deterministic CLI.

References:
- https://woodpecker-ci.org/docs/3.18/development/architecture
- https://woodpecker-ci.org/docs/3.18/usage/intro
- https://woodpecker-ci.org/docs/3.18/usage/plugins/overview
- https://woodpecker-ci.org/docs/3.18/administration/configuration/agent

## Recommended architecture

GitHub -> Woodpecker Server -> existing Agent (Docker backend) -> CI step image with runner + selected solvers -> JSON receipt -> Woodpecker build status + GitHub PR receipt link.

Candidate implementations, in recommended order:

| Mode | Fit | Benefits | Limitation |
|---|---|---|---|
| Docker Pipeline Step (P0) | Best immediate choice | Standard YAML, existing Docker agent, no server/agent patch | Must prebuild and pin image with solvers |
| Woodpecker Plugin container (P1) | Shared across repositories | Packaged settings/consistent behavior | Extra entrypoint and security tests |
| Networked MCP service (P1/P2) | Optional LLM-assisted jobs | Same API usable by IDE/ChatGPT and agents | Authentication, network exposure, ACL and availability |
| Embed solvers into woodpecker-agent binary (REJECT) | Wrong layer | No practical advantage | Bloats agent, couples upgrades, complicates isolation |

## Reusing current infrastructure

- Existing Docker backend is suitable for Linux x86_64 solver binaries, assuming Docker host architecture matches.
- Use a dedicated image whose immutable digest pins tool, runtime and dependency versions, not ad-hoc downloads per job.
- Never assume the Agent host has Python 3.14, Lean, Java 21, .NET 8 or the tool packages; install into step image.
- Separate images by tool family if resource size is excessive. Start with Z3+cvc5 and lightweight static tests; add Lean, TLC, Jena and ProB incrementally.
- Do not use GitHub Actions; Woodpecker is the CI executor. No need to redesign ADS/DKE/DIS DAGs merely to attach a formal check.

## Woodpecker 3.18 workflow examples

The repository includes .woodpecker/formal-static.yaml, a runnable *source-only* check with a plain Python base image. It does not download binaries and is not a real solver test.

Once you prebuild a verified image, adapt examples/woodpecker/formal-runtime-template.yaml into an enabled workflow and replace its placeholder image with an actual digest-pinned image. It deliberately is not placed directly under .woodpecker/, so CI does not trigger an unverified workload.

Woodpecker step exit code 0 means all configured expected fixture verdicts passed. Nonzero means fail/unknown. Inconclusive results must fail closed; negative examples with expected solver UNSAT may still pass the test. Preserve real stdout/stderr and model hashes, avoid treating build success as proof of full natural-language claims.

## Agent workload controls

- Default to agent max workflows=1 for heavy proof workloads; concurrency should be tuned from observed CPU/memory, not guessed.
- Apply per-step CPU/memory limits and 30–120s solver timeout. Use separate pools if saturation delays normal build/compile/test tasks.
- For trusted project source only, mount a writable temporary working directory, leave solvers' package paths read-only where possible, avoid Docker socket/host filesystem mounts.
- Use network-less step containers if the execution path supports it; do not put GitHub tokens into solver processes.
- Publishing evidence back to GitHub should be a separate narrowly authorized step, not a side effect hidden inside the solver runner.
- Do not change or restart the existing Agent or its configuration until a smoke test in the targeted Woodpecker 3.18 deployment is complete.

## Maturity and acceptance gates

A. Static YAML/schema/runner unit tests PASS; B. Build image and record its digest+SBOM+publisher hash verification; C. Run 13 positive and 13 negative fixtures in CI; D. Execute ADS/DKE/DIS real models and compare source contract to formalization; E. Adopt a small subset as PR gates. Until B–E have receipts, the Woodpecker runtime integration remains CANDIDATE, not implemented.

The static workflow does not prove the parser/CLI flags are accepted by actual proof-engine releases. For unsupported result parsers (currently Alloy/ProB), the runner returns INCONCLUSIVE and CI fails by design.
