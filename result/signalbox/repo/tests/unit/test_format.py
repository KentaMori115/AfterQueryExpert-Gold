from signalbox.layout.format import format_scheme
from signalbox.layout.parser import parse

PLAN = """
scheme kingsmoor {
    area "Kingsmoor Junction"
    prefix K
}
node A boundary
node P101 points throw 12
node B buffer
node C boundary
edge E1 from A to P101.toe length 600 speed 90 gradient 1 in 330 direction down
edge E2 from P101.normal to C length 400 direction down
edge E3 from P101.reverse to B length 150.5 speed 15
section TA over E1
section TB counted over E2, E3
signal S1 on E1 at 600 facing forward direction down aspects 4
crossing LC21 on E2 at 100 type ahb strike_in 30
trap TP1 on E3 at 20 facing backward
"""


def formatted():
    return format_scheme(parse(PLAN))


def test_formatting_is_stable():
    once = formatted()
    twice = format_scheme(parse(once))
    assert once == twice


def test_the_formatted_plan_still_parses():
    scheme = parse(formatted())
    assert scheme.area == "Kingsmoor Junction"
    assert len(scheme.edges) == 3
    assert len(scheme.traps) == 1


def test_the_header_comes_first():
    lines = formatted().splitlines()
    assert lines[0] == "scheme kingsmoor {"
    assert lines[1] == '    area "Kingsmoor Junction"'
    assert lines[2] == "    prefix K"


def test_names_are_lined_up():
    lines = [line for line in formatted().splitlines() if line.startswith("node ")]
    kinds = ("boundary", "points", "buffer")
    columns = {min(line.index(kind) for kind in kinds if kind in line) for line in lines}
    assert len(columns) == 1


def test_whole_numbers_lose_their_decimal_point():
    assert "length 600 " in formatted()
    assert "length 150.5" in formatted()


def test_gradients_and_speeds_are_kept():
    assert "speed 90 gradient 1 in 330" in formatted()


def test_counted_sections_say_so():
    assert "section TB counted over E2, E3" in formatted()


def test_signals_keep_their_aspects_last():
    line = next(line for line in formatted().splitlines() if line.startswith("signal"))
    assert line.endswith("aspects 4")
    assert "facing forward" in line


def test_crossings_and_traps_come_out():
    text = formatted()
    assert "crossing LC21 on E2 at 100 type ahb strike_in 30" in text
    assert "trap TP1 on E3 at 20 facing backward" in text


def test_node_attributes_are_kept():
    assert "node P101 points throw 12" in formatted()


def test_an_empty_plan_formats_to_nothing():
    assert format_scheme(parse("")) == ""


def test_a_plan_with_no_header_leaves_it_out():
    text = format_scheme(
        parse("node A boundary\nnode B boundary\nedge E1 from A to B length 5\n")
    )
    assert not text.startswith("scheme")
    assert text.startswith("node A")


def test_values_needing_quotes_get_them():
    text = format_scheme(parse('scheme x {\n  area "Two Words"\n}\n'))
    assert 'area "Two Words"' in text


def test_the_file_ends_with_one_newline():
    assert formatted().endswith("\n")
    assert not formatted().endswith("\n\n")
