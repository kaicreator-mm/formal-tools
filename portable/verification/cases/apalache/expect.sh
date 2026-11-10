EXPECT_TIMEOUT=300
EXPECT_POS_ARGS='check --inv=Inv tests/apalache/pos.tla'
EXPECT_POS_EXIT=0
EXPECT_POS_REGEX='(PASSED|No counterexample found)'
EXPECT_POS_LABEL=PROPERTY_HOLDS
EXPECT_NEG_ARGS='check --inv=BadInv tests/apalache/neg.tla'
EXPECT_NEG_EXIT=*
EXPECT_NEG_REGEX='(violated|FAILED|counterexample)'
EXPECT_NEG_LABEL=COUNTEREXAMPLE
EXPECT_ERR_ARGS='check tests/apalache/err.tla'
EXPECT_ERR_EXIT=1 2 3
EXPECT_ERR_REGEX='(error|Error|Failed|parse)'
EXPECT_ERR_LABEL=ERROR
