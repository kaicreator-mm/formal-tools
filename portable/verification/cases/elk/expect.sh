EXPECT_TIMEOUT=180
# ELK 0.6.0 does not expose consistency results on stdout/-s. The positive case
# must produce a non-empty taxonomy containing the expected Parent -> Person
# subsumption and ELK must successfully parse/classify that generated taxonomy.
# The negative case is intentionally parser rejection, not an ontology Oracle.
EXPECT_POS_VIA=sh
EXPECT_POS_ARGS='"$BUNDLE/runtimes/java21/bin/java" -cp "$BUNDLE/tools/elk/elk-cli.jar:$BUNDLE/tools/elk/lib/*" org.semanticweb.elk.cli.Main -c -i "$BUNDLE/tests/elk/pos.ofn" -o "$FT_TMP/tax.ofn" && test -s "$FT_TMP/tax.ofn" && grep -Fq "SubClassOf(<http://example.org/pos#Parent> <http://example.org/pos#Person>)" "$FT_TMP/tax.ofn" && "$BUNDLE/runtimes/java21/bin/java" -cp "$BUNDLE/tools/elk/elk-cli.jar:$BUNDLE/tools/elk/lib/*" org.semanticweb.elk.cli.Main -c -i "$FT_TMP/tax.ofn" -o "$FT_TMP/reparsed.ofn" && test -s "$FT_TMP/reparsed.ofn" && grep -Fq "SubClassOf(<http://example.org/pos#Parent> <http://example.org/pos#Person>)" "$FT_TMP/reparsed.ofn" && echo ELK_TAXONOMY_VERIFIED'
EXPECT_POS_EXIT=0
EXPECT_POS_REGEX='ELK_TAXONOMY_VERIFIED'
EXPECT_POS_LABEL=CLASSIFIED_TAXONOMY
# A valid but inconsistent OWL ontology must collapse owl:Thing to owl:Nothing.
# Judge ELK's produced taxonomy, not parser failure or the Runner's PHASE_DONE marker.
EXPECT_NEG_VIA=sh
EXPECT_NEG_ARGS='"$BUNDLE/runtimes/java21/bin/java" -cp "$BUNDLE/tools/elk/elk-cli.jar:$BUNDLE/tools/elk/lib/*" org.semanticweb.elk.cli.Main -c -i "$BUNDLE/tests/elk/neg.ofn" -o "$FT_TMP/neg-tax.ofn" && test -s "$FT_TMP/neg-tax.ofn" && grep -Fq "EquivalentClasses(<http://www.w3.org/2002/07/owl#Nothing> <http://www.w3.org/2002/07/owl#Thing>" "$FT_TMP/neg-tax.ofn" && "$BUNDLE/runtimes/java21/bin/java" -cp "$BUNDLE/tools/elk/elk-cli.jar:$BUNDLE/tools/elk/lib/*" org.semanticweb.elk.cli.Main -c -i "$FT_TMP/neg-tax.ofn" -o "$FT_TMP/neg-reparsed.ofn" && cmp -s "$FT_TMP/neg-tax.ofn" "$FT_TMP/neg-reparsed.ofn" && echo ELK_INCONSISTENCY_TAXONOMY_VERIFIED'
EXPECT_NEG_EXIT=0
EXPECT_NEG_REGEX='ELK_INCONSISTENCY_TAXONOMY_VERIFIED'
EXPECT_NEG_LABEL=INCONSISTENT_ONTOLOGY
EXPECT_ERR_ARGS='-c -i tests/elk/does-not-exist.ofn -o $FT_TMP/invalid.ofn'
EXPECT_ERR_EXIT=1
EXPECT_ERR_REGEX='FileNotFoundException: .*does-not-exist\.ofn'
EXPECT_ERR_LABEL=MISSING_SOURCE
