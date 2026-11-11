EXPECT_TIMEOUT=120
EXPECT_POS_ARGS='tests/souffle/pos.dl'
EXPECT_POS_EXIT=0
EXPECT_POS_REGEX='a=1.*b=3|path'
EXPECT_POS_LABEL=DERIVED
# negative: undeclared attribute name must be rejected (souffle is a positive-only
# engine; rejection of an invalid program is its real negative-path behavior)
EXPECT_NEG_ARGS='tests/souffle/badtypes.dl'
EXPECT_NEG_EXIT=*
EXPECT_NEG_REGEX='(Error|error|undeclared|unknown)'
EXPECT_NEG_LABEL=INVALID_REJECTED
# invalid input: missing file
EXPECT_ERR_ARGS='tests/souffle/does-not-exist.dl'
EXPECT_ERR_EXIT=*
EXPECT_ERR_REGEX='(Error|error|Could not|cannot)'
EXPECT_ERR_LABEL=ERROR
