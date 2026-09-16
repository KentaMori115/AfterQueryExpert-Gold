from signalbox.verify import checks as _checks  # noqa: F401
from signalbox.verify.guidance import GUIDANCE, Guidance, guidance_for, missing, spare
from signalbox.verify.rules import registered


def test_every_rule_has_guidance():
    assert missing([rule.code for rule in registered()]) == []


def test_there_is_no_guidance_for_rules_that_are_gone():
    assert spare() == []


def test_guidance_can_be_looked_up():
    found = guidance_for("flank-open")
    assert found is not None
    assert "run into the side" in found.why


def test_an_unknown_code_has_no_guidance():
    assert guidance_for("wibble") is None


def test_guidance_prints_as_a_short_block():
    text = str(guidance_for("flank-open"))
    assert text.startswith("flank-open")
    assert "why:" in text and "fix:" in text


def test_every_entry_says_why_and_how():
    for code, found in GUIDANCE.items():
        assert found.code == code
        assert found.why.endswith("."), code
        assert found.fix.endswith("."), code


def test_the_wording_is_not_left_as_a_placeholder():
    for found in GUIDANCE.values():
        assert "TODO" not in found.why
        assert len(found.why) > 30
        assert len(found.fix) > 10


def test_guidance_is_a_dataclass_that_can_be_made_by_hand():
    made = Guidance("x", "because.", "do this.")
    assert made.text().startswith("x")
