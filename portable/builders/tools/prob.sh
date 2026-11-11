# builders/tools/prob.sh — ProB model checker (prob-cli Linux bundle).
# Official distribution: stups.hhu-hosting.de (HHU Stups) — direct zip, no form gating.
# BLOCKER (verified empirically 2026-11-11): probcli 1.16.x/1.15.1 linux zips do NOT
# bundle probcliparser.jar (the Java B parser is a separate upstream artifact with no
# public release channel — probed: Maven Central de.hhu.stups:probcliparser absent,
# hhu-stups GitHub 404s, nightly zips identical). probcli fails at load_main_file
# without it, so the bundle cannot be honestly verified.
FT_TOOL_ID=prob
FT_TOOL_VERSION=1.16.1
FT_TOOL_KIND=java-bundle
FT_MAIN_BIN=""
FT_UPSTREAM_URL="https://stups.hhu-hosting.de/downloads/prob/cli/releases/1.16.1/probcli_linux64.zip"
FT_PROBE=(bin/probcli -version)

ft_tool_build() {
  ft::unavailable "probcli zips (1.16.1/1.15.1/nightly) lack probcliparser.jar — no public release channel for the parser artifact (maven/github probed); manual upstream support needed"
}

