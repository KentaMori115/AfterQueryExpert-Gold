import pytest

from signalbox.render.geometry import Point, place
from signalbox.render.svg import Canvas, Palette, render_svg
from signalbox.signalling.signal import Aspect
from signalbox.topology.scheme import scheme_from_text


@pytest.fixture
def drawing(kingsmoor):
    return render_svg(kingsmoor)


def test_the_drawing_is_an_svg_document(drawing):
    assert drawing.startswith("<svg xmlns=")
    assert drawing.rstrip().endswith("</svg>")


def test_the_drawing_has_a_size(drawing):
    assert 'width="' in drawing and 'height="' in drawing
    assert "viewBox=" in drawing


def test_every_edge_is_drawn(kingsmoor, drawing):
    assert drawing.count("<line") >= len(kingsmoor.graph.edges)


def test_sections_are_labelled(drawing):
    assert ">TA<" in drawing
    assert ">TL<" in drawing


def test_signals_are_labelled(drawing):
    assert ">K1<" in drawing
    assert ">K22<" in drawing


def test_points_are_labelled(drawing):
    assert ">P101<" in drawing


def test_the_area_becomes_the_heading(drawing):
    assert "Kingsmoor Junction" in drawing


def test_a_title_can_be_given(kingsmoor):
    assert "Stage 2" in render_svg(kingsmoor, title="Stage 2")


def test_occupied_track_is_drawn_in_the_occupied_colour(kingsmoor):
    palette = Palette()
    plain = render_svg(kingsmoor)
    busy = render_svg(kingsmoor, occupied={"TA"})
    assert busy.count(palette.occupied) > plain.count(palette.occupied)


def test_aspects_colour_the_signal_heads(kingsmoor):
    palette = Palette()
    green = render_svg(kingsmoor, aspects={"K1": Aspect.GREEN})
    assert palette.for_aspect(Aspect.GREEN) in green


def test_signals_default_to_red(kingsmoor):
    assert Palette().for_aspect(Aspect.RED) in render_svg(kingsmoor)


def test_a_placement_can_be_given(kingsmoor):
    placement = place(kingsmoor, scale=0.2)
    wide = render_svg(kingsmoor, placement)
    assert len(wide) > 0


def test_an_empty_scheme_still_draws_something():
    drawing = render_svg(scheme_from_text(""))
    assert drawing.startswith("<svg")


def test_labels_are_escaped():
    scheme = scheme_from_text(
        'scheme x {\n  area "Bell & Sons Sidings"\n}\n'
        "node A boundary\nnode B boundary\nedge E1 from A to B length 100\n"
    )
    assert "Bell &amp; Sons Sidings" in render_svg(scheme)


def test_the_canvas_writes_plain_elements():
    canvas = Canvas()
    canvas.line(Point(0, 0), Point(10, 0), "#000", 2.0)
    canvas.circle(Point(5, 5), 3.0, "#fff")
    canvas.text(Point(1, 2), "hello", "#333")
    canvas.rect(Point(0, 0), 4.0, 5.0, "#eee")
    output = canvas.render()
    assert "<line" in output and "<circle" in output
    assert ">hello<" in output and "<rect" in output


def test_extra_attributes_are_written_in_order():
    canvas = Canvas()
    canvas.line(Point(0, 0), Point(1, 1), "#000", 1.0, opacity="0.5")
    assert 'opacity="0.5"' in canvas.render()
