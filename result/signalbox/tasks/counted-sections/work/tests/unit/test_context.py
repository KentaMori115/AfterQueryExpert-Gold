from signalbox.errors import LayoutError
from signalbox.layout.context import Excerpt, excerpt, excerpt_for, explain

PLAN = """node A boundary
node B boundary
edge E1 from A to B
section TA over E1
"""


def test_the_offending_line_is_marked():
    text = excerpt(PLAN, 3).text()
    assert "> 3 | edge E1 from A to B" in text


def test_the_lines_either_side_come_too():
    text = excerpt(PLAN, 3).text()
    assert "  2 | node B boundary" in text
    assert "  4 | section TA over E1" in text


def test_more_context_can_be_asked_for():
    assert len(excerpt(PLAN, 3, context=2).lines) == 4


def test_the_first_line_has_nothing_above_it():
    found = excerpt(PLAN, 1)
    assert found.lines[0][0] == 1


def test_a_line_that_is_not_there_gives_nothing():
    assert excerpt(PLAN, 99).is_empty
    assert excerpt(PLAN, 0).is_empty
    assert excerpt(PLAN, 99).text() == ""


def test_a_column_gets_a_caret():
    text = excerpt(PLAN, 3, column=6).text()
    assert "^" in text
    assert text.splitlines()[2].index("^") > 0


def test_without_a_column_there_is_no_caret():
    assert "^" not in excerpt(PLAN, 3).text()


def test_line_numbers_are_lined_up():
    long_plan = "\n".join(f"node N{i} boundary" for i in range(12))
    text = excerpt(long_plan, 10, context=2).text()
    numbers = [line.split("|")[0] for line in text.splitlines()]
    assert len({len(number) for number in numbers}) == 1


def test_an_error_with_no_line_has_no_excerpt():
    assert excerpt_for(LayoutError("something", source="x.sbx")) is None
    assert excerpt_for(LayoutError("something", line=3)) is None


def test_an_error_can_be_shown_against_the_text_it_came_from():
    error = LayoutError("edge E1 has no length", source="plan.sbx", line=3)
    text = explain(error, PLAN)
    assert "plan.sbx:3" in text
    assert "edge E1 from A to B" in text


def test_an_error_can_read_the_file_itself(tmp_path):
    path = tmp_path / "plan.sbx"
    path.write_text(PLAN)
    error = LayoutError("edge E1 has no length", source=str(path), line=3)
    assert "edge E1 from A to B" in explain(error)


def test_a_file_that_has_gone_gives_the_error_on_its_own(tmp_path):
    error = LayoutError("gone", source=str(tmp_path / "nothing.sbx"), line=3)
    assert explain(error) == str(error)


def test_an_error_with_no_source_gives_the_error_on_its_own():
    error = LayoutError("no idea")
    assert explain(error) == "no idea"


def test_excerpts_print_themselves():
    found = Excerpt("x.sbx", 1, ((1, "node A boundary"),))
    assert str(found) == "> 1 | node A boundary\n"
