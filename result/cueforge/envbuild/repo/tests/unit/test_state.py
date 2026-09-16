from cueforge.codes import CF4003_ILLEGAL_STATE, CF4006_BAD_TRANSITION
from cueforge.resources.state import ResourceState, apply_transition


def test_legal_transition() -> None:
    state = ResourceState("revolve", "locked", ("locked", "scene_two"))
    nxt, findings = apply_transition(state, cue_id="auto_07", required="locked", next_state="scene_two")
    assert findings == []
    assert nxt.current == "scene_two"


def test_illegal_required_state() -> None:
    state = ResourceState("revolve", "home", ("locked", "home", "scene_two"))
    _, findings = apply_transition(state, cue_id="auto_07", required="locked", next_state="scene_two")
    assert any(item.code == CF4003_ILLEGAL_STATE for item in findings)


def test_unknown_next_state() -> None:
    state = ResourceState("revolve", "locked", ("locked", "home"))
    _, findings = apply_transition(state, cue_id="auto_07", required="locked", next_state="orbit")
    assert any(item.code == CF4006_BAD_TRANSITION for item in findings)
