EXPECT_TIMEOUT=120
EXPECT_POS_ARGS='tests/souffle/pos.dl'
EXPECT_POS_EXIT=0
EXPECT_POS_REGEX='^1[[:space:]]+3$'
EXPECT_POS_LABEL=DERIVED
# NEG is an invalid Datalog program: undeclared relation/attribute use is rejected.
# This is a parser/compiler negative, not a valid-but-false business property.
EXPECT_NEG_ARGS='tests/souffle/badtypes.dl'
EXPECT_NEG_EXIT=1
EXPECT_NEG_REGEX='^Error: Undefined relation path in file badtypes\.dl at line 4$'
EXPECT_NEG_LABEL=INVALID_REJECTED
# ERR is a missing input file.
EXPECT_ERR_ARGS='tests/souffle/does-not-exist.dl'
EXPECT_ERR_EXIT=1
EXPECT_ERR_REGEX='^cannot open file tests/souffle/does-not-exist\.dl$'
EXPECT_ERR_LABEL=MISSING_INPUT_REJECTED
