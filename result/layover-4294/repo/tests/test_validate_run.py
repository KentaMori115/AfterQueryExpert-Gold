"""Running the checks and collecting the findings."""

import unittest

from layover.validate import Findings, Severity, check_names, validate
from layover.validate.finding import Finding
from tests.support import loaded_feed


def findings():
    return Findings(
        [
            Finding("b-check", Severity.NOTICE, "third"),
            Finding("a-check", Severity.ERROR, "first"),
            Finding("c-check", Severity.WARNING, "second", "subject"),
        ]
    )


class FindingsTest(unittest.TestCase):
    def setUp(self):
        self.findings = findings()

    def test_counts_them(self):
        self.assertEqual(len(self.findings), 3)

    def test_is_truthy_when_something_was_found(self):
        self.assertTrue(self.findings)

    def test_an_empty_collection_is_falsy(self):
        self.assertFalse(Findings())

    def test_they_come_back_worst_first(self):
        self.assertEqual(self.findings[0].check, "a-check")

    def test_iterating_keeps_that_order(self):
        self.assertEqual([finding.check for finding in self.findings][-1], "b-check")

    def test_errors_are_picked_out(self):
        self.assertEqual(len(self.findings.errors), 1)

    def test_warnings_are_picked_out(self):
        self.assertEqual(len(self.findings.warnings), 1)

    def test_notices_are_picked_out(self):
        self.assertEqual(len(self.findings.notices), 1)

    def test_findings_of_one_check(self):
        self.assertEqual(len(self.findings.of_check("c-check")), 1)

    def test_findings_of_an_unknown_check(self):
        self.assertEqual(self.findings.of_check("nope"), ())

    def test_the_checks_that_fired(self):
        self.assertEqual(self.findings.checks_fired(), ("a-check", "b-check", "c-check"))

    def test_a_collection_with_an_error_has_not_passed(self):
        self.assertFalse(self.findings.passed)

    def test_a_collection_without_errors_has_passed(self):
        self.assertTrue(Findings([Finding("c", Severity.WARNING, "boom")]).passed)

    def test_an_empty_collection_is_clean(self):
        self.assertTrue(Findings().clean)

    def test_a_collection_with_a_notice_is_not_clean(self):
        self.assertFalse(self.findings.clean)

    def test_the_counts(self):
        self.assertEqual(self.findings.counts(), {"error": 1, "warning": 1, "notice": 1})

    def test_the_messages_are_lines(self):
        self.assertEqual(len(self.findings.messages()), 3)

    def test_the_summary(self):
        self.assertEqual(self.findings.summary(), "1 errors, 1 warnings, 1 notices")

    def test_renders_as_the_summary(self):
        self.assertEqual(str(self.findings), self.findings.summary())

    def test_the_report_has_a_row_each(self):
        self.assertEqual(len(self.findings.as_report()), 3)

    def test_the_report_notes_the_counts(self):
        self.assertIn("1 errors, 1 warnings, 1 notices.", self.findings.as_report().notes)

    def test_a_clean_report_says_so(self):
        self.assertIn("Nothing to report.", Findings().as_report().notes)

    def test_the_report_takes_a_title(self):
        self.assertEqual(self.findings.as_report("Checks").title, "Checks")


class ValidateTest(unittest.TestCase):
    def setUp(self):
        self.contents = loaded_feed()

    def test_running_everything_finds_something(self):
        self.assertTrue(validate(self.contents))

    def test_the_demo_feed_has_no_errors(self):
        self.assertTrue(validate(self.contents).passed)

    def test_running_one_check(self):
        found = validate(self.contents, only=["service-gaps"])
        self.assertEqual(found.checks_fired(), ("service-gaps",))

    def test_skipping_a_check(self):
        found = validate(self.contents, skip=["service-gaps"])
        self.assertNotIn("service-gaps", found.checks_fired())

    def test_skipping_everything_finds_nothing(self):
        self.assertTrue(validate(self.contents, skip=check_names()).clean)

    def test_an_unknown_check_in_only_raises(self):
        with self.assertRaises(KeyError):
            validate(self.contents, only=["nope"])

    def test_an_unknown_check_in_skip_raises(self):
        with self.assertRaises(KeyError):
            validate(self.contents, skip=["nope"])

    def test_only_and_skip_together(self):
        found = validate(self.contents, only=["service-gaps", "unused-stops"], skip=["service-gaps"])
        self.assertTrue(found.clean)

    def test_the_run_is_repeatable(self):
        first = validate(self.contents).messages()
        self.assertEqual(first, validate(self.contents).messages())


if __name__ == "__main__":
    unittest.main()
