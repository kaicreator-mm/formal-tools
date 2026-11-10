EXPECT_TIMEOUT=180
# elk-cli 0.6.0 does not surface consistency results on stdout/-s (verified empirically:
# consistent and inconsistent both exit 0 silently). Judged here on real reasoning output:
# positive = full classification run writes a taxonomy; negative = malformed ontology rejected.
# Limitation is recorded in the build receipt (upstream_note).
EXPECT_POS_ARGS='-c -i tests/elk/pos.ofn -o $FT_TMP/tax.ttl'
EXPECT_POS_EXIT=0
EXPECT_POS_REGEX='PHASE_DONE.*rc=0'
EXPECT_POS_LABEL=CLASSIFIED
EXPECT_NEG_ARGS='-c -i tests/elk/err.ofn -o $FT_TMP/tax.ttl'
EXPECT_NEG_EXIT=*
EXPECT_NEG_REGEX='(Exception|error|Cannot load|TokenMgr)'
EXPECT_NEG_LABEL=PARSE_REJECTED
