"""Reading the fields of a row, and collecting what goes wrong."""

import unittest
from datetime import date

from layover.errors import FeedError, Location
from layover.feed.parse import Problems, RowReader, read_boolean, read_integer
from layover.feed.reader import read_text
from layover.times import parse_clock


def reader(text="stop_id,name,lat,lon\na,Stop A,52.5,\n", problems=None):
    table = read_text("stops", text)
    return RowReader(table.rows[0], Problems() if problems is None else problems)


class BooleanTest(unittest.TestCase):
    def test_reads_the_true_words(self):
        for text in ("1", "true", "TRUE", "yes", "y", "t"):
            with self.subTest(text=text):
                self.assertTrue(read_boolean(text))

    def test_reads_the_false_words(self):
        for text in ("0", "false", "no", "n", "f", ""):
            with self.subTest(text=text):
                self.assertFalse(read_boolean(text))

    def test_rejects_nonsense(self):
        with self.assertRaises(FeedError):
            read_boolean("maybe")

    def test_carries_the_place(self):
        where = Location("stops", 1, "pickup")
        with self.assertRaises(FeedError) as caught:
            read_boolean("maybe", where)
        self.assertIs(caught.exception.where, where)


class IntegerTest(unittest.TestCase):
    def test_reads_a_number(self):
        self.assertEqual(read_integer("42"), 42)

    def test_reads_a_negative(self):
        self.assertEqual(read_integer("-3"), -3)

    def test_tolerates_space(self):
        self.assertEqual(read_integer(" 42 "), 42)

    def test_rejects_a_decimal(self):
        with self.assertRaises(FeedError):
            read_integer("4.2")

    def test_rejects_empty(self):
        with self.assertRaises(FeedError):
            read_integer("  ")

    def test_rejects_letters(self):
        with self.assertRaises(FeedError):
            read_integer("forty")


class ProblemsTest(unittest.TestCase):
    def test_starts_empty(self):
        self.assertFalse(Problems())

    def test_counts_what_is_added(self):
        problems = Problems()
        problems.note("first")
        problems.note("second")
        self.assertEqual(len(problems), 2)

    def test_is_truthy_once_something_is_wrong(self):
        problems = Problems()
        problems.note("first")
        self.assertTrue(problems)

    def test_keeps_the_order(self):
        problems = Problems()
        problems.note("first")
        problems.note("second")
        self.assertEqual(problems.messages()[0], "first")

    def test_iterating_gives_the_errors(self):
        problems = Problems()
        problems.note("first")
        self.assertIsInstance(list(problems)[0], FeedError)

    def test_raising_with_nothing_wrong_does_nothing(self):
        Problems().raise_if_any()

    def test_raising_one_problem_raises_it(self):
        problems = Problems()
        problems.note("only this")
        with self.assertRaises(FeedError) as caught:
            problems.raise_if_any()
        self.assertEqual(str(caught.exception), "only this")

    def test_raising_several_says_how_many(self):
        problems = Problems()
        problems.note("first")
        problems.note("second")
        with self.assertRaises(FeedError) as caught:
            problems.raise_if_any()
        self.assertIn("2 problems", str(caught.exception))

    def test_a_limit_gives_up(self):
        problems = Problems(limit=1)
        problems.note("first")
        with self.assertRaises(FeedError):
            problems.note("second")

    def test_renders_a_count(self):
        self.assertEqual(str(Problems()), "0 problems")


class RowReaderTest(unittest.TestCase):
    def test_reads_a_required_field(self):
        self.assertEqual(reader().text("stop_id"), "a")

    def test_a_missing_required_field_is_a_problem(self):
        problems = Problems()
        value = reader("stop_id,name\n,Stop A\n", problems).text("stop_id", "?")
        self.assertEqual(value, "?")
        self.assertEqual(len(problems), 1)

    def test_a_failed_read_marks_the_row(self):
        row = reader("stop_id,name\n,Stop A\n")
        row.text("stop_id")
        self.assertTrue(row.failed)

    def test_a_good_row_is_not_marked(self):
        row = reader()
        row.text("stop_id")
        self.assertFalse(row.failed)

    def test_an_optional_field_falls_back(self):
        self.assertIsNone(reader().optional_text("lon"))

    def test_an_optional_field_takes_a_fallback(self):
        self.assertEqual(reader().optional_text("lon", "0"), "0")

    def test_reads_an_integer(self):
        table = read_text("stop_times", "trip_id,sequence,arrival\nt,3,08:00\n")
        self.assertEqual(RowReader(table.rows[0], Problems()).integer("sequence"), 3)

    def test_a_bad_integer_is_a_problem(self):
        problems = Problems()
        table = read_text("stop_times", "trip_id,sequence,arrival\nt,three,08:00\n")
        value = RowReader(table.rows[0], problems).integer("sequence", -1)
        self.assertEqual(value, -1)
        self.assertEqual(len(problems), 1)

    def test_an_optional_integer_falls_back(self):
        table = read_text("patterns", "pattern_id,route_id,direction\np,r,\n")
        self.assertEqual(RowReader(table.rows[0], Problems()).optional_integer("direction", 0), 0)

    def test_a_boolean_falls_back_when_blank(self):
        table = read_text("pattern_stops", "pattern_id,sequence,stop_id,pickup\np,1,a,\n")
        self.assertTrue(RowReader(table.rows[0], Problems()).boolean("pickup", True))

    def test_a_bad_boolean_is_a_problem(self):
        problems = Problems()
        table = read_text("pattern_stops", "pattern_id,sequence,stop_id,pickup\np,1,a,maybe\n")
        RowReader(table.rows[0], problems).boolean("pickup")
        self.assertEqual(len(problems), 1)

    def test_reads_a_clock_time(self):
        table = read_text("stop_times", "trip_id,sequence,arrival\nt,1,08:05\n")
        self.assertEqual(RowReader(table.rows[0], Problems()).clock("arrival"), parse_clock("08:05"))

    def test_a_bad_clock_time_is_a_problem(self):
        problems = Problems()
        table = read_text("stop_times", "trip_id,sequence,arrival\nt,1,eight\n")
        RowReader(table.rows[0], problems).clock("arrival")
        self.assertEqual(len(problems), 1)

    def test_an_optional_clock_falls_back(self):
        table = read_text("stop_times", "trip_id,sequence,arrival,departure\nt,1,08:05,\n")
        row = RowReader(table.rows[0], Problems())
        self.assertEqual(row.optional_clock("departure", 99), 99)

    def test_reads_a_date(self):
        table = read_text("calendar_dates", "service_id,date\ns,2026-07-14\n")
        self.assertEqual(RowReader(table.rows[0], Problems()).date("date"), date(2026, 7, 14))

    def test_a_bad_date_is_a_problem(self):
        problems = Problems()
        table = read_text("calendar_dates", "service_id,date\ns,the fourteenth\n")
        RowReader(table.rows[0], problems).date("date")
        self.assertEqual(len(problems), 1)

    def test_a_choice_reads_one_of_the_words(self):
        table = read_text("calendar_dates", "service_id,date,exception\ns,2026-07-14,remove\n")
        row = RowReader(table.rows[0], Problems())
        self.assertEqual(row.choice("exception", ("add", "remove"), "add"), "remove")

    def test_a_choice_falls_back_when_blank(self):
        table = read_text("calendar_dates", "service_id,date,exception\ns,2026-07-14,\n")
        row = RowReader(table.rows[0], Problems())
        self.assertEqual(row.choice("exception", ("add", "remove"), "add"), "add")

    def test_a_choice_outside_the_list_is_a_problem(self):
        problems = Problems()
        table = read_text("calendar_dates", "service_id,date,exception\ns,2026-07-14,maybe\n")
        RowReader(table.rows[0], problems).choice("exception", ("add", "remove"), "add")
        self.assertEqual(len(problems), 1)

    def test_building_a_value_returns_it(self):
        row = reader()
        self.assertEqual(row.built(int, "42"), 42)

    def test_a_failed_build_becomes_a_problem(self):
        problems = Problems()
        row = reader(problems=problems)

        def boom():
            raise FeedError("no good")

        self.assertIsNone(row.built(boom))
        self.assertEqual(len(problems), 1)

    def test_a_failed_build_gets_a_place(self):
        problems = Problems()
        row = reader(problems=problems)

        def boom():
            raise FeedError("no good")

        row.built(boom)
        self.assertEqual(problems.found[0].where.table, "stops")


if __name__ == "__main__":
    unittest.main()
