from cueforge.identifiers import is_valid_identifier


def test_valid_identifiers() -> None:
    assert is_valid_identifier("lx_21")
    assert is_valid_identifier("line_17")
    assert is_valid_identifier("A")


def test_invalid_identifiers() -> None:
    assert not is_valid_identifier("")
    assert not is_valid_identifier("1bad")
    assert not is_valid_identifier("has space")
    assert not is_valid_identifier("x" * 129)
