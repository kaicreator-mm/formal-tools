EXPECT_TIMEOUT=180
EXPECT_POS_ARGS='reason --reasoner ELK --input tests/robot/pos.ttl --output $FT_TMP/reasoned.ttl'
EXPECT_POS_EXIT=0
EXPECT_POS_REGEX='PHASE_DONE.*rc=0'
EXPECT_POS_LABEL=CONSISTENT
EXPECT_NEG_ARGS='reason --reasoner ELK --input tests/robot/neg.ttl'
EXPECT_NEG_EXIT=*
EXPECT_NEG_REGEX='(Inconsistent|inconsistent|Exception|error)'
EXPECT_NEG_LABEL=INCONSISTENT
EXPECT_ERR_ARGS='reason --reasoner ELK --input tests/robot/err.ttl'
EXPECT_ERR_EXIT='*'
EXPECT_ERR_REGEX='(Exception|error|Error|parse)'
EXPECT_ERR_LABEL=ERROR
