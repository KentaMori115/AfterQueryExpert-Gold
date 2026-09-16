from signalbox.render.geometry import Point
from signalbox.render.legend import ENTRIES, Entry, draw_legend, height, width
from signalbox.render.svg import Canvas, render_svg


def test_the_key_has_a_row_for_each_mark():
    assert len(ENTRIES) == 7
    assert str(ENTRIES[0]) == "track: plain line"


def test_the_key_is_as_tall_as_its_rows():
    assert height() > height(ENTRIES[:2])
    assert width() > 0


def test_drawing_the_key_puts_something_on_the_canvas():
    canvas = Canvas()
    draw_legend(canvas, Point(0.0, 0.0))
    output = canvas.render()
    assert ">key<" in output
    assert ">plain line<" in output
    assert ">buffer stop<" in output


def test_the_key_draws_a_sample_for_every_row():
    canvas = Canvas()
    draw_legend(canvas, Point(0.0, 0.0))
    assert canvas.render().count("<line") >= len(ENTRIES)


def test_an_unknown_mark_still_gets_its_label():
    canvas = Canvas()
    draw_legend(canvas, Point(0.0, 0.0), entries=(Entry("wibble", "something else"),))
    assert ">something else<" in canvas.render()


def test_the_drawing_can_be_asked_for_a_key(kingsmoor):
    without = render_svg(kingsmoor)
    with_key = render_svg(kingsmoor, legend=True)
    assert ">key<" not in without
    assert ">key<" in with_key


def test_the_key_makes_the_drawing_taller(kingsmoor):
    def tall(text):
        return float(text.split('height="')[1].split('"')[0])

    assert tall(render_svg(kingsmoor, legend=True)) > tall(render_svg(kingsmoor))
