EXPECT_TIMEOUT=300
# ProB writes .inprogress scratch next to the model file — copy cases to writable tmp
EXPECT_SETUP_VIA=sh
EXPECT_SETUP_ARGS='cp $BUNDLE/tests/prob/pos.mch $FT_TMP/pos.mch; cp $BUNDLE/tests/prob/neg.mch $FT_TMP/neg.mch; cp $BUNDLE/tests/prob/err.mch $FT_TMP/err.mch'
EXPECT_POS_ARGS='-mc 100 $FT_TMP/pos.mch'
EXPECT_POS_EXIT=0
EXPECT_POS_REGEX='ALL OPERATIONS COVERED'
EXPECT_POS_LABEL=PROPERTY_HOLDS
EXPECT_NEG_ARGS='-mc 100 $FT_TMP/neg.mch'
EXPECT_NEG_EXIT=*
EXPECT_NEG_REGEX='COUNTER EXAMPLE FOUND'
EXPECT_NEG_LABEL=COUNTEREXAMPLE
EXPECT_ERR_ARGS='-mc 100 $FT_TMP/err.mch'
EXPECT_ERR_EXIT=*
EXPECT_ERR_REGEX='(Parse error|error|Error)'
EXPECT_ERR_LABEL=ERROR
