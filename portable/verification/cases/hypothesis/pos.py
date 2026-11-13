from hypothesis import given, strategies as st


@given(st.lists(st.integers()))
def sorted_is_sorted(xs):
    assert sorted(xs) == sorted(sorted(xs))


sorted_is_sorted()  # raises nothing when property holds
print("PYVERIFY: OK PROPERTY_HELD")
