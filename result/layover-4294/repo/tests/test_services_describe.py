"""Calendars written out as a timetable footnote would write them."""

import unittest
from datetime import date

from layover.dates import DateRange, weekday_mask
from layover.services.calendar import ServiceCalendar
from layover.services.describe import describe_calendar, describe_registry, describe_weekdays
from layover.services.registry import ServiceRegistry

JULY = DateRange(date(2026, 7, 1), date(2026, 7, 31))


class WeekdayWordingTest(unittest.TestCase):
    def test_a_run_becomes_a_dash(self):
        self.assertEqual(describe_weekdays(weekday_mask(["mon", "tue", "wed", "thu", "fri"])), "Mon-Fri")

    def test_a_pair_is_listed(self):
        self.assertEqual(describe_weekdays(weekday_mask(["sat", "sun"])), "Sat, Sun")

    def test_a_single_day(self):
        self.assertEqual(describe_weekdays(weekday_mask(["wed"])), "Wed")

    def test_every_day(self):
        self.assertEqual(describe_weekdays(weekday_mask(range(7))), "daily")

    def test_no_day(self):
        self.assertEqual(describe_weekdays(0), "no weekday")

    def test_two_runs_are_separated(self):
        mask = weekday_mask(["mon", "tue", "wed", "sat"])
        self.assertEqual(describe_weekdays(mask), "Mon-Wed, Sat")

    def test_a_split_week(self):
        mask = weekday_mask(["mon", "wed", "fri"])
        self.assertEqual(describe_weekdays(mask), "Mon, Wed, Fri")


class CalendarWordingTest(unittest.TestCase):
    def test_a_plain_weekly_service(self):
        calendar = ServiceCalendar.weekly("s", ["mon", "tue", "wed", "thu", "fri"], JULY)
        self.assertEqual(describe_calendar(calendar), "Mon-Fri, 2026-07-01..2026-07-31")

    def test_an_exception_is_named(self):
        calendar = ServiceCalendar.weekly("s", ["mon"], JULY, removed=[date(2026, 7, 6)])
        self.assertTrue(describe_calendar(calendar).endswith("not 2026-07-06"))

    def test_added_dates_are_named(self):
        calendar = ServiceCalendar.weekly("s", ["mon"], JULY, added=[date(2026, 7, 4)])
        self.assertIn("also 2026-07-04", describe_calendar(calendar))

    def test_a_dates_only_calendar(self):
        calendar = ServiceCalendar.on_dates("s", [date(2026, 7, 14)])
        self.assertEqual(describe_calendar(calendar), "on 2026-07-14")

    def test_a_long_list_is_cut_short(self):
        days = [date(2026, 7, day) for day in range(1, 9)]
        calendar = ServiceCalendar.on_dates("s", days)
        self.assertIn("and 5 more", describe_calendar(calendar))

    def test_the_limit_can_be_raised(self):
        days = [date(2026, 7, day) for day in range(1, 9)]
        calendar = ServiceCalendar.on_dates("s", days)
        self.assertNotIn("more", describe_calendar(calendar, limit=8))

    def test_a_registry_is_one_line_per_service(self):
        registry = ServiceRegistry(
            [
                ServiceCalendar.weekly("weekday", ["mon"], JULY),
                ServiceCalendar.weekly("weekend", ["sat", "sun"], JULY),
            ]
        )
        lines = describe_registry(registry)
        self.assertEqual(len(lines), 2)
        self.assertTrue(lines[0].startswith("weekday: "))

    def test_registry_lines_are_sorted(self):
        registry = ServiceRegistry(
            [
                ServiceCalendar.weekly("b", ["mon"], JULY),
                ServiceCalendar.weekly("a", ["mon"], JULY),
            ]
        )
        self.assertTrue(describe_registry(registry)[0].startswith("a: "))


if __name__ == "__main__":
    unittest.main()
