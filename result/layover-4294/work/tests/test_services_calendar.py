"""One service calendar and the dates it covers."""

import unittest
from datetime import date

from layover.dates import DateRange, weekday_mask
from layover.errors import ServiceError
from layover.services.calendar import ServiceCalendar

JULY = DateRange(date(2026, 7, 1), date(2026, 7, 31))
BASTILLE = date(2026, 7, 14)


def weekday_service(**changes):
    settings = dict(
        service_id="weekday",
        days=["mon", "tue", "wed", "thu", "fri"],
        period=JULY,
    )
    settings.update(changes)
    return ServiceCalendar.weekly(**settings)


class BuildTest(unittest.TestCase):
    def test_keeps_the_identifier(self):
        self.assertEqual(weekday_service().service_id, "weekday")

    def test_trims_the_identifier(self):
        self.assertEqual(weekday_service(service_id="  s1 ").service_id, "s1")

    def test_rejects_an_empty_identifier(self):
        with self.assertRaises(ServiceError):
            weekday_service(service_id="   ")

    def test_rejects_a_pattern_with_no_period(self):
        with self.assertRaises(ServiceError):
            ServiceCalendar("s1", weekday_mask(["mon"]), None)

    def test_rejects_a_calendar_that_never_runs(self):
        with self.assertRaises(ServiceError):
            ServiceCalendar("s1", 0, JULY)

    def test_rejects_an_oversized_mask(self):
        with self.assertRaises(ServiceError):
            ServiceCalendar("s1", 0b11111111, JULY)

    def test_freezes_the_exception_sets(self):
        calendar = weekday_service(removed=[BASTILLE])
        self.assertIsInstance(calendar.removed, frozenset)

    def test_dates_only_calendar_needs_no_period(self):
        calendar = ServiceCalendar.on_dates("special", [BASTILLE])
        self.assertEqual(calendar.active_dates(), (BASTILLE,))

    def test_dates_only_calendar_refuses_an_empty_list(self):
        with self.assertRaises(ServiceError):
            ServiceCalendar.on_dates("special", [])

    def test_weekly_takes_numbers(self):
        self.assertEqual(
            ServiceCalendar.weekly("s1", [0, 1], JULY).weekdays, weekday_mask([0, 1])
        )

    def test_is_hashable(self):
        self.assertEqual(len({weekday_service(), weekday_service()}), 1)


class RunsOnTest(unittest.TestCase):
    def setUp(self):
        self.calendar = weekday_service(removed=[BASTILLE])

    def test_runs_on_a_weekday(self):
        self.assertTrue(self.calendar.runs_on(date(2026, 7, 1)))

    def test_does_not_run_at_the_weekend(self):
        self.assertFalse(self.calendar.runs_on(date(2026, 7, 4)))

    def test_does_not_run_on_a_removed_date(self):
        self.assertFalse(self.calendar.runs_on(BASTILLE))

    def test_does_not_run_outside_the_period(self):
        self.assertFalse(self.calendar.runs_on(date(2026, 8, 3)))

    def test_runs_on_an_added_date_outside_the_period(self):
        calendar = self.calendar.with_added([date(2026, 8, 3)])
        self.assertTrue(calendar.runs_on(date(2026, 8, 3)))

    def test_runs_on_an_added_weekend(self):
        calendar = self.calendar.with_added([date(2026, 7, 4)])
        self.assertTrue(calendar.runs_on(date(2026, 7, 4)))

    def test_removing_beats_adding(self):
        calendar = ServiceCalendar(
            "s1", weekday_mask(["mon"]), JULY, frozenset([BASTILLE]), frozenset([BASTILLE])
        )
        self.assertFalse(calendar.runs_on(BASTILLE))

    def test_removing_a_date_it_never_ran_changes_nothing(self):
        calendar = self.calendar.with_removed([date(2026, 7, 5)])
        self.assertEqual(calendar.active_dates(), self.calendar.active_dates())


class ActiveDatesTest(unittest.TestCase):
    def setUp(self):
        self.calendar = weekday_service(removed=[BASTILLE])

    def test_counts_the_weekdays_of_july(self):
        self.assertEqual(self.calendar.count(), 22)

    def test_dates_come_back_in_order(self):
        days = self.calendar.active_dates()
        self.assertEqual(list(days), sorted(days))

    def test_the_removed_date_is_gone(self):
        self.assertNotIn(BASTILLE, self.calendar.active_dates())

    def test_first_and_last(self):
        self.assertEqual(self.calendar.first_date, date(2026, 7, 1))
        self.assertEqual(self.calendar.last_date, date(2026, 7, 31))

    def test_span_covers_first_to_last(self):
        self.assertEqual(self.calendar.span, DateRange(date(2026, 7, 1), date(2026, 7, 31)))

    def test_a_full_calendar_is_not_empty(self):
        self.assertFalse(self.calendar.is_empty)

    def test_a_calendar_removed_to_nothing_is_empty(self):
        calendar = ServiceCalendar.weekly("s1", ["mon"], JULY).with_removed(
            ServiceCalendar.weekly("s1", ["mon"], JULY).active_dates()
        )
        self.assertTrue(calendar.is_empty)
        self.assertIsNone(calendar.first_date)
        self.assertIsNone(calendar.span)

    def test_weekday_names_come_back(self):
        self.assertEqual(self.calendar.weekday_names()[0], "monday")
        self.assertEqual(len(self.calendar.weekday_names()), 5)

    def test_added_dates_are_included_once(self):
        calendar = self.calendar.with_added([date(2026, 7, 1)])
        self.assertEqual(calendar.count(), self.calendar.count())


class DerivedCalendarTest(unittest.TestCase):
    def setUp(self):
        self.calendar = weekday_service()

    def test_renaming_keeps_the_days(self):
        renamed = self.calendar.renamed("other")
        self.assertEqual(renamed.service_id, "other")
        self.assertEqual(renamed.active_dates(), self.calendar.active_dates())

    def test_clipping_keeps_only_the_window(self):
        window = DateRange(date(2026, 7, 6), date(2026, 7, 10))
        clipped = self.calendar.clipped(window)
        self.assertEqual(clipped.count(), 5)

    def test_clipping_writes_the_days_out(self):
        window = DateRange(date(2026, 7, 6), date(2026, 7, 10))
        self.assertEqual(self.calendar.clipped(window).weekdays, 0)

    def test_clipping_to_nothing_raises(self):
        window = DateRange(date(2026, 8, 1), date(2026, 8, 2))
        with self.assertRaises(ServiceError):
            self.calendar.clipped(window)

    def test_two_ways_of_writing_the_same_days_agree(self):
        listed = ServiceCalendar.on_dates("listed", self.calendar.active_dates())
        self.assertTrue(self.calendar.same_days_as(listed))

    def test_different_days_do_not_agree(self):
        other = ServiceCalendar.weekly("weekend", ["sat", "sun"], JULY)
        self.assertFalse(self.calendar.same_days_as(other))

    def test_adding_returns_a_new_calendar(self):
        self.assertIsNot(self.calendar.with_added([BASTILLE]), self.calendar)

    def test_the_original_is_untouched(self):
        self.calendar.with_removed([date(2026, 7, 1)])
        self.assertTrue(self.calendar.runs_on(date(2026, 7, 1)))

    def test_renders_with_a_day_count(self):
        self.assertEqual(str(self.calendar), "weekday (23 days)")

    def test_describes_the_first_dates(self):
        self.assertEqual(
            self.calendar.describe_dates(2), "2026-07-01, 2026-07-02 and 21 more"
        )

    def test_describes_a_short_calendar_in_full(self):
        calendar = ServiceCalendar.on_dates("one", [BASTILLE])
        self.assertEqual(calendar.describe_dates(), "2026-07-14")


if __name__ == "__main__":
    unittest.main()
