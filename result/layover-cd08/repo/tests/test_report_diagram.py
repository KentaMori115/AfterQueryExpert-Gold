"""Line diagrams: the picture on the wall of the carriage."""

import unittest

from layover.errors import NetworkError
from layover.report.diagram import END, INTERCHANGE, STOP, diagram_report, line_diagram, route_diagrams
from tests.support import line_network


class DiagramReportTest(unittest.TestCase):
    def setUp(self):
        self.network = line_network()
        self.report = diagram_report(self.network, "x-east")

    def test_a_row_per_stop(self):
        self.assertEqual(len(self.report), 4)

    def test_the_ends_are_marked_differently(self):
        self.assertEqual(self.report.rows[0][0], END)
        self.assertEqual(self.report.rows[-1][0], END)

    def test_a_plain_stop_is_a_plain_mark(self):
        self.assertEqual(self.report.rows[1][0], STOP)

    def test_an_interchange_is_marked(self):
        self.assertEqual(self.report.rows[2][0], INTERCHANGE)

    def test_the_interchange_says_where_to_change(self):
        self.assertEqual(self.report.rows[2][2], "Y")

    def test_a_plain_stop_has_nothing_to_change_to(self):
        self.assertEqual(self.report.rows[1][2], "")

    def test_the_stops_are_named(self):
        self.assertEqual(self.report.rows[0][1], "Stop A")

    def test_the_title_names_the_route(self):
        self.assertEqual(self.report.title, "tram X")

    def test_the_headsign_is_noted(self):
        self.assertIn("Towards East.", self.report.notes)

    def test_the_stop_count_is_noted(self):
        self.assertTrue(any("4 stops." in note for note in self.report.notes))

    def test_a_title_can_be_given(self):
        report = diagram_report(self.network, "x-east", "The X line")
        self.assertEqual(report.title, "The X line")

    def test_an_unknown_pattern_raises(self):
        with self.assertRaises(NetworkError):
            diagram_report(self.network, "nope")

    def test_it_renders_as_csv(self):
        self.assertTrue(self.report.as_csv().startswith(",Stop,Change to"))


class LineDiagramTest(unittest.TestCase):
    def setUp(self):
        self.network = line_network()
        self.lines = line_diagram(self.network, "x-east")

    def test_there_is_a_line_between_the_stops(self):
        self.assertEqual(len(self.lines), 7)

    def test_the_first_line_is_the_first_stop(self):
        self.assertTrue(self.lines[0].startswith("O  Stop A"))

    def test_the_track_is_drawn_between_them(self):
        self.assertEqual(self.lines[1], STOP)

    def test_a_change_is_written_out(self):
        self.assertIn("change for Y", "\n".join(self.lines))

    def test_changes_can_be_left_off(self):
        plain = line_diagram(self.network, "x-east", changes=False)
        self.assertNotIn("change for", "\n".join(plain))

    def test_nothing_has_trailing_space(self):
        for line in self.lines:
            with self.subTest(line=line):
                self.assertEqual(line, line.rstrip())

    def test_the_names_line_up(self):
        starts = [line.index("Stop") for line in self.lines if "Stop" in line]
        self.assertEqual(len(set(starts)), 1)


class RouteDiagramTest(unittest.TestCase):
    def test_one_diagram_per_pattern(self):
        self.assertEqual(len(route_diagrams(line_network(), "x")), 2)

    def test_the_directions_start_at_opposite_ends(self):
        first, second = route_diagrams(line_network(), "x")
        self.assertEqual(first.rows[0][1], "Stop A")
        self.assertEqual(second.rows[0][1], "Stop D")

    def test_an_unknown_route_raises(self):
        with self.assertRaises(NetworkError):
            route_diagrams(line_network(), "z")


if __name__ == "__main__":
    unittest.main()
