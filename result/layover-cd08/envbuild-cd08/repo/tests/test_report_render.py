"""Reports and the three ways they render."""

import unittest

from layover.errors import LayoverError
from layover.report.render import Rendering, Report, align_columns, text_table


def report(**changes):
    settings = dict(
        title="Departures",
        headers=("Time", "Route"),
        rows=(("08:00", "X"), ("08:10", "Y")),
    )
    settings.update(changes)
    return Report(**settings)


class RenderingTest(unittest.TestCase):
    def test_reads_a_name(self):
        self.assertIs(Rendering.parse("markdown"), Rendering.MARKDOWN)

    def test_ignores_case(self):
        self.assertIs(Rendering.parse("CSV"), Rendering.CSV)

    def test_passes_a_rendering_through(self):
        self.assertIs(Rendering.parse(Rendering.TEXT), Rendering.TEXT)

    def test_rejects_nonsense(self):
        with self.assertRaises(LayoverError):
            Rendering.parse("pdf")

    def test_renders_as_its_name(self):
        self.assertEqual(str(Rendering.TEXT), "text")


class LayoutTest(unittest.TestCase):
    def test_column_widths_take_the_longest(self):
        self.assertEqual(align_columns([("a", "bbb"), ("cc", "d")]), (2, 3))

    def test_no_rows_give_no_widths(self):
        self.assertEqual(align_columns([]), ())

    def test_a_ragged_row_is_allowed(self):
        self.assertEqual(align_columns([("a",), ("bb", "cc")]), (2, 2))

    def test_a_table_has_a_rule_under_the_header(self):
        lines = text_table(("Time", "Route"), [("08:00", "X")])
        self.assertTrue(set(lines[1]) == {"-"})

    def test_the_columns_line_up(self):
        lines = text_table(("Time", "Route"), [("08:00", "X"), ("8:00", "YY")])
        self.assertEqual(lines[2].index("X"), lines[3].index("Y"))

    def test_right_alignment_pushes_to_the_edge(self):
        lines = text_table(("N",), [("1",), ("100",)], right=[0])
        self.assertTrue(lines[2].endswith("  1"))

    def test_lines_have_no_trailing_space(self):
        for line in text_table(("Time", "Route"), [("08:00", "X")]):
            with self.subTest(line=line):
                self.assertEqual(line, line.rstrip())


class ReportTest(unittest.TestCase):
    def setUp(self):
        self.report = report()

    def test_counts_its_rows(self):
        self.assertEqual(len(self.report), 2)

    def test_a_report_with_rows_is_not_empty(self):
        self.assertFalse(self.report.is_empty)

    def test_a_report_with_no_rows_is_empty(self):
        self.assertTrue(report(rows=()).is_empty)

    def test_a_row_has_to_match_the_header(self):
        with self.assertRaises(LayoverError):
            report(rows=(("08:00",),))

    def test_cells_are_made_into_text(self):
        self.assertEqual(report(rows=((1, 2),)).rows[0], ("1", "2"))

    def test_the_text_rendering_starts_with_the_title(self):
        self.assertTrue(self.report.as_text().startswith("Departures\n"))

    def test_the_text_rendering_holds_the_rows(self):
        self.assertIn("08:10", self.report.as_text())

    def test_the_markdown_rendering_has_a_heading(self):
        self.assertTrue(self.report.as_markdown().startswith("## Departures"))

    def test_the_markdown_rendering_has_a_separator(self):
        self.assertIn("| --- | --- |", self.report.as_markdown())

    def test_the_markdown_rendering_escapes_a_pipe(self):
        text = report(rows=(("a|b", "X"),)).as_markdown()
        self.assertIn("a\\|b", text)

    def test_the_csv_rendering_starts_with_the_header(self):
        self.assertTrue(self.report.as_csv().startswith("Time,Route\n"))

    def test_the_csv_rendering_has_no_title(self):
        self.assertNotIn("Departures", self.report.as_csv())

    def test_the_csv_rendering_ends_with_a_newline(self):
        self.assertTrue(self.report.as_csv().endswith("\n"))

    def test_rendering_by_name(self):
        self.assertEqual(self.report.render("csv"), self.report.as_csv())

    def test_rendering_defaults_to_text(self):
        self.assertEqual(self.report.render(), self.report.as_text())

    def test_notes_appear_in_the_text(self):
        self.assertIn("Nothing here.", report(notes=("Nothing here.",)).as_text())

    def test_notes_appear_as_bullets_in_markdown(self):
        self.assertIn("- Nothing here.", report(notes=("Nothing here.",)).as_markdown())

    def test_notes_do_not_appear_in_csv(self):
        self.assertNotIn("Nothing", report(notes=("Nothing here.",)).as_csv())

    def test_adding_a_note(self):
        self.assertEqual(len(self.report.with_notes(["one"]).notes), 1)

    def test_adding_a_note_keeps_the_rows(self):
        self.assertEqual(self.report.with_notes(["one"]).rows, self.report.rows)

    def test_a_report_with_no_title_renders_without_one(self):
        self.assertTrue(report(title="").as_text().startswith("Time"))

    def test_renders_a_summary(self):
        self.assertEqual(str(self.report), "Departures (2 rows)")

    def test_is_hashable(self):
        self.assertEqual(len({report(), report()}), 1)


if __name__ == "__main__":
    unittest.main()
