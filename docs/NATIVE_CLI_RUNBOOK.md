# CLI native coverage: operating notes

This R4 adds 53 validated common-operation command plans across 13 tool families, and a local CLI-only pass-through for the installed tool's **full native option surface**. This avoids hardcoding hundreds of version-specific flags, but is not a promise that those flags have been successfully executed in the assistant's restricted JavaScript environment.

A user-visible command inventory is in docs/NATIVE_CLI_COVERAGE.md, and the canonical registry is packages/runner/js/native-catalog.mjs. The official binary --help remains the version-specific authority.

The three evaluation stages are kept distinct:
- Pure JS planning checked in ChatGPT's JS runtime.
- Node.js command launching and TypeScript/MCP runtime checks require a Node host.
- Actual model check/solver proof requires each third-party CLI installed and a versioned receipt.

For cross-language interfaces, it is acceptable that Clingo and pySHACL themselves depend on Python: the orchestration layer, CLI, MCP and command catalog are **all JavaScript**.
