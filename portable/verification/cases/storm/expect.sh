EXPECT_TIMEOUT=180
EXPECT_POS_ARGS='--prism tests/storm/pos.pm --prop "P>=0.1 [F s=7]"'
EXPECT_POS_EXIT=0
EXPECT_POS_REGEX='Result( \(for initial states\))?: true'
EXPECT_POS_LABEL=PROPERTY_HOLDS
EXPECT_NEG_ARGS='--prism tests/storm/pos.pm --prop "P<=0.5 [F s=7]"'
EXPECT_NEG_EXIT=*
EXPECT_NEG_REGEX='Result( \(for initial states\))?: false'
EXPECT_NEG_LABEL=PROPERTY_FAILS
