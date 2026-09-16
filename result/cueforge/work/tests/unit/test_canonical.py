from cueforge.reports.canonical_json import canonical_dumps, sha256_text


def test_key_order_does_not_change_bytes() -> None:
    left = canonical_dumps({"b": 1, "a": 2})
    right = canonical_dumps({"a": 2, "b": 1})
    assert left == right
    assert left == '{"a":2,"b":1}\n'


def test_digest_is_stable() -> None:
    text = canonical_dumps({"production": "x", "cues": []})
    assert sha256_text(text) == sha256_text(text)
    assert len(sha256_text(text)) == 64


def test_rejects_float() -> None:
    try:
        canonical_dumps({"x": 1.2})
    except TypeError:
        return
    raise AssertionError("floats must be rejected")
