from pathlib import Path

from cueforge.production.json_loader import parse_json_text
from cueforge.production.source_map import is_path_escape
from cueforge.production.yaml_loader import parse_yaml_text


def test_yaml_keeps_decimal_as_text() -> None:
    data = parse_yaml_text("maximum_speed: 1.4\noffset: -800\n")
    assert data["maximum_speed"] == "1.4"
    assert data["offset"] == "-800"


def test_json_keeps_numeric_tokens_as_text() -> None:
    data = parse_json_text('{"duration": 1500, "speed": 1.4}')
    assert data["duration"] == "1500"
    assert data["speed"] == "1.4"


def test_path_escape_detection() -> None:
    assert is_path_escape("../secret.yaml")
    assert is_path_escape("/etc/passwd")
    assert not is_path_escape("cues/lighting.yaml")


def test_yaml_bool_and_null() -> None:
    data = parse_yaml_text("manual: true\nnotes: null\n")
    assert data["manual"] is True
    assert data["notes"] is None


def test_mixed_nested_numbers(tmp_path: Path) -> None:
    text = "locations:\n  center: {x: 8, y: 5}\n"
    data = parse_yaml_text(text)
    assert data["locations"]["center"]["x"] == "8"
    assert tmp_path.exists()
