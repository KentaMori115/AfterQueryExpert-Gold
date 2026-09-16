from cueforge.findings import Finding, Severity
from cueforge.result import Result


def test_ok_requires_value_and_no_errors() -> None:
    result = Result.ok("value")
    assert result.is_ok
    assert result.value == "value"


def test_warnings_keep_ok() -> None:
    result = Result.ok("value", [Finding("CF7004", Severity.WARNING, "pending")])
    assert result.is_ok


def test_errors_fail_even_with_value() -> None:
    result = Result("value", (Finding("CF3002", Severity.ERROR, "cycle"),))
    assert not result.is_ok
    assert result.errors[0].code == "CF3002"


def test_fail_has_no_value() -> None:
    result: Result[str] = Result.fail([Finding("CF1005", Severity.ERROR, "parse")])
    assert result.value is None
    assert not result.is_ok
