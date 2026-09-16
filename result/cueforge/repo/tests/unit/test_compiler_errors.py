from cueforge.compiler.plan import compile_production_document
from cueforge.production.build import production_from_mapping


def _compile(data: dict[object, object]):
    production, findings = production_from_mapping(data, "memory")  # type: ignore[arg-type]
    assert production is not None, findings
    return compile_production_document(production)


def test_self_dependency() -> None:
    show, findings = _compile(
        {
            "version": 1,
            "production": "self",
            "time_unit": "ms",
            "cues": [
                {"id": "a", "department": "lx", "trigger": {"after": "a"}, "duration": 1},
            ],
        }
    )
    assert show is None
    assert any(item.code == "CF3003" for item in findings)


def test_missing_event() -> None:
    _, findings = _compile(
        {
            "version": 1,
            "production": "evt",
            "time_unit": "ms",
            "cues": [
                {"id": "a", "department": "lx", "trigger": {"on": "line_9"}, "duration": 1},
            ],
        }
    )
    assert any(item.code == "CF1002" for item in findings)


def test_unknown_resource() -> None:
    _, findings = _compile(
        {
            "version": 1,
            "production": "res",
            "time_unit": "ms",
            "cues": [
                {
                    "id": "a",
                    "department": "video",
                    "trigger": {"at": 0},
                    "duration": 1,
                    "uses": ["ghost"],
                },
            ],
        }
    )
    assert any(item.code == "CF4004" for item in findings)


def test_short_travel_duration() -> None:
    show, findings = _compile(
        {
            "version": 1,
            "production": "walk",
            "time_unit": "ms",
            "performers": {"mira": {"initial_mark": "a"}},
            "locations": {"a": {"x": 0, "y": 0}, "b": {"x": 8, "y": 0}},
            "cues": [
                {
                    "id": "cross",
                    "department": "stage",
                    "trigger": {"at": 0},
                    "duration": 10,
                    "action": {
                        "move": "mira",
                        "from": "a",
                        "to": "b",
                        "maximum_speed": "1.4",
                    },
                }
            ],
        }
    )
    assert any(item.code == "CF5001" for item in findings)
    assert show is not None


def test_empty_cues() -> None:
    production, _ = production_from_mapping(
        {"version": 1, "production": "empty", "time_unit": "ms", "cues": []},
        "memory",
    )
    assert production is not None
    show, findings = compile_production_document(production)
    assert show is None
    assert any(item.code == "CF3006" for item in findings)


def test_scientific_duration() -> None:
    _, findings = _compile(
        {
            "version": 1,
            "production": "sci",
            "time_unit": "ms",
            "cues": [
                {"id": "a", "department": "lx", "trigger": {"at": 0}, "duration": "1e3"},
            ],
        }
    )
    assert any(item.code == "CF2002" for item in findings)
