import pytest

from signalbox.errors import LayoutError
from signalbox.standards import DEFAULT_STANDARDS, FIGURES, Standards
from signalbox.topology.scheme import scheme_from_text

PLAN = """
standards {{
{settings}
}}

node A boundary
node B boundary
edge E1 from A to B length 900 speed 60 direction down
section TA over E1
"""


def scheme_with(settings=""):
    return scheme_from_text(PLAN.format(settings=settings))


def test_the_defaults_are_the_usual_figures():
    assert DEFAULT_STANDARDS.overlap.metres == 183.0
    assert DEFAULT_STANDARDS.braking == 0.45
    assert DEFAULT_STANDARDS.flank.metres == 400.0


def test_a_scheme_with_no_block_gets_the_defaults():
    assert scheme_with().standards == DEFAULT_STANDARDS


def test_a_figure_in_the_plan_is_used():
    scheme = scheme_with("    overlap 250\n    braking 0.6")
    assert scheme.standards.overlap.metres == 250.0
    assert scheme.standards.braking == 0.6


def test_the_other_figures_keep_their_defaults():
    scheme = scheme_with("    overlap 250")
    assert scheme.standards.flank.metres == DEFAULT_STANDARDS.flank.metres


def test_every_figure_can_be_set():
    settings = "\n".join(f"    {name} 7" for name in FIGURES)
    scheme = scheme_with(settings)
    assert scheme.standards.approach == 7.0
    assert scheme.standards.route_limit.metres == 7.0


def test_an_unknown_figure_is_refused():
    with pytest.raises(LayoutError, match="unknown design figure 'colour'"):
        Standards.from_settings({"colour": 3.0})


def test_a_figure_that_is_not_positive_is_refused():
    with pytest.raises(LayoutError, match="greater than zero"):
        Standards.from_settings({"overlap": 0.0})


def test_the_standards_describe_themselves():
    text = DEFAULT_STANDARDS.describe()
    assert "overlap 183m" in text
    assert "braking 0.45" in text
    assert str(DEFAULT_STANDARDS) == text


def test_the_figures_are_documented():
    assert set(FIGURES) == {
        "overlap",
        "reduced_overlap",
        "braking",
        "reaction",
        "flank",
        "approach",
        "throw",
        "route_limit",
    }
    assert all(FIGURES.values())


def test_standards_are_merged_from_an_included_plan(tmp_path):
    from signalbox.layout.loader import load_path

    (tmp_path / "figures.sbx").write_text("standards {\n  overlap 250\n}\n")
    top = tmp_path / "top.sbx"
    top.write_text(
        'include "figures.sbx"\n'
        "node A boundary\nnode B boundary\nedge E1 from A to B length 400\n"
    )
    assert load_path(top).standards == {"overlap": 250.0}


def test_the_including_plan_wins(tmp_path):
    from signalbox.layout.loader import load_path

    (tmp_path / "figures.sbx").write_text("standards {\n  overlap 250\n}\n")
    top = tmp_path / "top.sbx"
    top.write_text(
        "standards {\n  overlap 100\n}\n"
        'include "figures.sbx"\n'
        "node A boundary\nnode B boundary\nedge E1 from A to B length 400\n"
    )
    assert load_path(top).standards == {"overlap": 100.0}
