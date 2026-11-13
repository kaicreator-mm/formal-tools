from hypothesis import given

# A strategy rather than None is required; this must raise InvalidArgument.
@given(None)
def invalid_contract(x):
    pass

invalid_contract()
