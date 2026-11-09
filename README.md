# Formal Tools Skill

Independent, versioned Agent Skills for formal proof and symbolic verification across ADS, DKE, DIS and Domain-Forge.

**Single source of truth:** this GitHub repository for Skills, validation protocol and reusable experiences. **One offline package location:** [Google Drive App/Formal-Methods/packages](https://drive.google.com/drive/folders/1GqX-Dn42Xi_STaoWYoq4aRXi3le2WPHB). Keep third-party binary files in Drive, not in Git.

## Repository

- `plugin.json`: skills-only private plugin manifest (source only; not yet installed)
- `skills/`: 13 tool Skills plus formal-tool-router (14 total)
- `registry/SKILL_REGISTRY.json`: tool versions, source links and maturity
- `docs/`: provenance, verification rules, packaging and migration
- `packages/`: index of actual Drive installers and bundle manifests (no binaries)
- `experience/`: reusable, append-only lessons and cross-project defects
- `validation/`: positive/negative runtime acceptance requirements

**Status:** `SOURCE_REVIEWED / RUNTIME_NOT_VERIFIED`. A Skill file does not execute a tool or automatically register as a ChatGPT Skill. Install a packaged skills-only plugin before cross-chat discovery, and use a Linux runner for actual executables.

This repository migrates the draft from [domain-forge PR #210](https://github.com/kaicreator-mm/domain-forge/pull/210) source SHA `51e2b6c4a55bbca5ce79a10c7f162a05299498d2`; the old PR is historical and should no longer be used as an editable authority.

[Router](skills/formal-tool-router/SKILL.md) · [Registry](registry/SKILL_REGISTRY.json) · [Provenance](docs/PROVENANCE.md) · [Package index](packages/INDEX.json) · [Experience](experience/EXPERIENCE_LOG.md)
