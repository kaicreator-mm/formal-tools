EXPECT_TIMEOUT=120
EXPECT_POS_ARGS='--fuzz-smoke'
EXPECT_POS_EXIT=0
EXPECT_POS_REGEX='AFL_RESULT: EXECS_DONE='
EXPECT_POS_LABEL=FUZZER_EXECS
# -n bypasses instrumentation checks so this case reaches the missing input-dir guard.
EXPECT_NEG_ARGS='-n -i $TOOL_DIR/does-not-exist -o $FT_TMP/afl-out $TOOL_DIR/test-target $TOOL_DIR/testcases/seed'
EXPECT_NEG_EXIT=1
EXPECT_NEG_REGEX='The input directory does not seem to be valid'
EXPECT_NEG_LABEL=INVALID_INPUT_DIRECTORY
EXPECT_ERR_ARGS='--definitely-not-an-afl-flag'
EXPECT_ERR_EXIT=1
EXPECT_ERR_REGEX='invalid option --'
EXPECT_ERR_LABEL=INVALID_ARGUMENT
