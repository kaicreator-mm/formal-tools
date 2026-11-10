EXPECT_TIMEOUT=120
EXPECT_POS_ARGS='--validate tests/apache-jena/pos.ttl'
EXPECT_POS_EXIT=0
EXPECT_POS_REGEX='PHASE_DONE.*rc=0'
EXPECT_POS_LABEL=RDF_VALID
EXPECT_NEG_ARGS='--validate tests/apache-jena/neg.ttl'
EXPECT_NEG_EXIT=*
EXPECT_NEG_REGEX='(Failed|Exception|error|Error)'
EXPECT_NEG_LABEL=RDF_INVALID
EXPECT_ERR_ARGS='--validate tests/apache-jena/does-not-exist.ttl'
EXPECT_ERR_EXIT=*
EXPECT_ERR_REGEX='(Failed|Exception|error|Error|not found|No such)'
EXPECT_ERR_LABEL=ERROR
