from cueforge.production.yaml_loader import parse_yaml_text


def test_on_is_not_a_boolean_key() -> None:
    data = parse_yaml_text("trigger: {on: line_17, offset: -800}\n")
    assert data["trigger"]["on"] == "line_17"
    assert "True" not in data["trigger"]
    assert "False" not in data["trigger"]
