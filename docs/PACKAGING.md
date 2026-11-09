# Skills-only plugin package

The directory `repository root` is deliberately installable as a self-contained *source tree* named `formal-methods` with `plugin.json` and `skills/`.

- Archive with **exactly one** top-level directory `formal-methods/` containing `plugin.json`, `skills/formal-tool-router/SKILL.md`, the 13 tool `SKILL.md` files and references.
- Use the ChatGPT Plugin Creator private `create_plugin` workflow with the actual local archive path. The creator API does **not** accept a GitHub or Drive URL directly.
- After installation, confirm the skill router and 13 individual skills are discoverable in a new conversation. A plugin providing instructions **does not install binaries**, and does not provide Linux execution by itself.
- Never claim successful plugin installation until the runtime reports a plugin ID and plugin URL, then verify by reading an installed skill.
- Before publication run frontmatter validation, relative-reference check, plugin-manifest schema validation, representative positive/negative model tests and versioned receipts.

The Drive `App/Formal-Methods/skills` folder is reserved for released skill ZIP snapshots. GitHub PR/source remains canonical for changes and history.
