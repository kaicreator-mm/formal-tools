# Per-tool licenses (redistribution notes)

Bundle redistributes upstream binaries/configs as downloaded from official channels. Each
tool directory ships the upstream artifacts unmodified (plus generated shims/meta). License
references; full texts are included in each tool's payload where upstream provides them.

| tool | license | note |
|---|---|---|
| lean4 | Apache-2.0 | official release toolchain |
| z3 | MIT | official release binary |
| cvc5 | BSD-3 (static build) | official release |
| vampire | BSD-3 | official release binary |
| cbmc | BSD-3 | official deb unpacked |
| tla-tlc | MIT | tla2tools.jar (Maven Central) |
| apalache | Apache-2.0 | official release zip |
| alloy | EPL-2.0 / MIT mix | official dist jar + our Apache-2.0-compatible runner |
| apache-jena | Apache-2.0 | official binary distribution |
| prob | EPL-1.0 (ProB core), custom CLI terms | prob-cli bundle |
| dafny | MIT (internal), MS-.NET-libs | official release zip |
| why3 | LGPL-2.1 | source build |
| souffle | UPL-1.0 | official deb unpacked |
| clingo | MIT | source build |
| minizinc | MPL-2.0 (bundle incl. solvers under own licenses) | official bundle |
| storm | GPL-3.0 (image payload) | docker movesrwth/storm:stable extraction |
| prism | GPL-2.0 | official release |
| nuxmv | NOT REDISTRIBUTED (license-gated) | blocked, see receipts |
| fast-downward | GPL-3.0 | source build |
| kani | Apache-2.0/MIT (toolchain per rust components) | official release bundle |
| aflpp | Apache-2.0 | source build |
| tree-sitter | MIT | CLI binary + python binding (MIT) + grammars (per grammar) |
| fast-check | MIT | npm tarballs |
| python313 runtime | PSF-2.0 | compiled from python.org source |
| node22 runtime | MIT | official tarball |
| java21 runtime | GPLv2+CE (Temurin) | Adoptium JRE |
| dotnet8 runtime (if present) | MIT | Microsoft runtime tarball |
| py libs | per-PyPI project (numpy BSD, pymc Apache-2.0, ...) | wheels installed into shared runtime |
