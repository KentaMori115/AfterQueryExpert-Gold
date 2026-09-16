"""Findings and how serious they are."""

import unittest

from layover.errors import LayoverError, Location
from layover.validate.finding import Finding, Severity


class SeverityTest(unittest.TestCase):
    def test_reads_a_name(self):
        self.assertIs(Severity.parse("warning"), Severity.WARNING)

    def test_ignores_case(self):
        self.assertIs(Severity.parse("ERROR"), Severity.ERROR)

    def test_passes_a_severity_through(self):
        self.assertIs(Severity.parse(Severity.NOTICE), Severity.NOTICE)

    def test_rejects_nonsense(self):
        with self.assertRaises(LayoverError):
            Severity.parse("disaster")

    def test_errors_sort_first(self):
        self.assertLess(Severity.ERROR.rank, Severity.WARNING.rank)

    def test_notices_sort_last(self):
        self.assertGreater(Severity.NOTICE.rank, Severity.WARNING.rank)

    def test_renders_as_its_name(self):
        self.assertEqual(str(Severity.WARNING), "warning")


class FindingTest(unittest.TestCase):
    def setUp(self):
        self.finding = Finding("unused-stops", Severity.WARNING, "nothing calls here", "a")

    def test_keeps_the_check(self):
        self.assertEqual(self.finding.check, "unused-stops")

    def test_reads_a_severity_name(self):
        self.assertIs(Finding("c", "error", "boom").severity, Severity.ERROR)

    def test_an_error_knows_it(self):
        self.assertTrue(Finding("c", "error", "boom").is_error)

    def test_a_warning_is_not_an_error(self):
        self.assertFalse(self.finding.is_error)

    def test_needs_a_check_name(self):
        with self.assertRaises(LayoverError):
            Finding("  ", Severity.WARNING, "boom")

    def test_needs_a_message(self):
        with self.assertRaises(LayoverError):
            Finding("c", Severity.WARNING, "   ")

    def test_a_subject_is_optional(self):
        self.assertEqual(Finding("c", Severity.NOTICE, "boom").subject, "")

    def test_a_place_is_optional(self):
        self.assertIsNone(self.finding.where)

    def test_a_place_is_kept(self):
        where = Location("stops", 3)
        self.assertIs(Finding("c", "error", "boom", where=where).where, where)

    def test_describes_itself(self):
        self.assertEqual(
            self.finding.describe(), "warning [unused-stops] a: nothing calls here"
        )

    def test_describes_itself_without_a_subject(self):
        finding = Finding("c", Severity.NOTICE, "boom")
        self.assertEqual(finding.describe(), "notice [c] boom")

    def test_renders_as_its_description(self):
        self.assertEqual(str(self.finding), self.finding.describe())

    def test_errors_sort_before_warnings(self):
        error = Finding("z", Severity.ERROR, "boom")
        self.assertLess(error.sort_key(), self.finding.sort_key())

    def test_is_hashable(self):
        self.assertEqual(
            len({Finding("c", "error", "boom"), Finding("c", "error", "boom")}), 1
        )


if __name__ == "__main__":
    unittest.main()
