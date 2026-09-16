from cueforge.assertions.evaluate import evaluate_assertions
from cueforge.assertions.grammar import BeforeExpr, StateAtExpr, parse_assertion
from cueforge.codes import CF6001_ASSERTION_FAILED, CF6002_ASSERTION_SYNTAX


def test_parse_before() -> None:
    expr, finding = parse_assertion("mira_cross.completed before video_12.visible")
    assert finding is None
    assert isinstance(expr, BeforeExpr)
    assert expr.left.cue_id == "mira_cross"
    assert expr.right.attr == "visible"


def test_parse_state_at() -> None:
    expr, finding = parse_assertion("revolve.state == scene_two at video_12.visible")
    assert finding is None
    assert isinstance(expr, StateAtExpr)
    assert expr.resource_id == "revolve"
    assert expr.expected == "scene_two"


def test_parse_error() -> None:
    _, finding = parse_assertion("this is not an assertion")
    assert finding is not None
    assert finding.code == CF6002_ASSERTION_SYNTAX


def test_before_success_and_failure() -> None:
    instants = {
        "a": {"completed": 10, "visible": 0, "started": 0, "failed": None},
        "b": {"completed": 30, "visible": 20, "started": 20, "failed": None},
    }
    ok = evaluate_assertions(["a.completed before b.visible"], instants, {}, [])
    assert ok == []
    bad = evaluate_assertions(["b.completed before a.visible"], instants, {}, [])
    assert any(item.code == CF6001_ASSERTION_FAILED for item in bad)


def test_state_at_uses_timeline() -> None:
    instants = {"v": {"visible": 100, "started": 100, "completed": 200, "failed": None}}
    timeline = [(50, 1, "revolve", "scene_two")]
    findings = evaluate_assertions(
        ["revolve.state == scene_two at v.visible"],
        instants,
        {"revolve": "scene_two"},
        timeline,
        {"revolve": "home"},
    )
    assert findings == []
    early = evaluate_assertions(
        ["revolve.state == scene_two at v.visible"],
        {"v": {"visible": 40, "started": 40, "completed": 80, "failed": None}},
        {"revolve": "scene_two"},
        timeline,
        {"revolve": "home"},
    )
    assert any(item.code == CF6001_ASSERTION_FAILED for item in early)
