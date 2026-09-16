"""Calendar dates, weekday masks and inclusive ranges."""

import unittest
from datetime import date

from layover.dates import (
    DateRange,
    WEEKDAY_NAMES,
    days_between,
    format_date,
    mask_contains,
    mask_names,
    next_weekday,
    parse_date,
    parse_weekday,
    weekday_mask,
)
from layover.errors import Location, ServiceError


class ParseDateTest(unittest.TestCase):
    def test_reads_a_dashed_date(self):
        self.assertEqual(parse_date("2026-07-01"), date(2026, 7, 1))

    def test_reads_a_packed_date(self):
        self.assertEqual(parse_date("20260701"), date(2026, 7, 1))

    def test_tolerates_space(self):
        self.assertEqual(parse_date("  2026-07-01 "), date(2026, 7, 1))

    def test_passes_a_date_through(self):
        day = date(2026, 7, 1)
        self.assertIs(parse_date(day), day)

    def test_rejects_a_bad_month(self):
        with self.assertRaises(ServiceError):
            parse_date("2026-13-01")

    def test_rejects_a_bad_day(self):
        with self.assertRaises(ServiceError):
            parse_date("2026-02-30")

    def test_rejects_nonsense(self):
        with self.assertRaises(ServiceError):
            parse_date("the first")

    def test_rejects_a_number(self):
        with self.assertRaises(ServiceError):
            parse_date(20260701)

    def test_carries_the_place(self):
        where = Location("calendar", 3, "start_date")
        with self.assertRaises(ServiceError) as caught:
            parse_date("nope", where)
        self.assertIs(caught.exception.where, where)

    def test_formats_back(self):
        self.assertEqual(format_date(date(2026, 7, 1)), "2026-07-01")

    def test_round_trips(self):
        for text in ("2026-01-01", "2026-02-28", "2028-02-29", "2026-12-31"):
            with self.subTest(text=text):
                self.assertEqual(format_date(parse_date(text)), text)


class WeekdayTest(unittest.TestCase):
    def test_names_start_on_monday(self):
        self.assertEqual(WEEKDAY_NAMES[0], "monday")

    def test_there_are_seven(self):
        self.assertEqual(len(WEEKDAY_NAMES), 7)

    def test_reads_a_full_name(self):
        self.assertEqual(parse_weekday("wednesday"), 2)

    def test_reads_a_short_name(self):
        self.assertEqual(parse_weekday("sat"), 5)

    def test_ignores_case_and_space(self):
        self.assertEqual(parse_weekday("  SUN "), 6)

    def test_rejects_nonsense(self):
        with self.assertRaises(ServiceError):
            parse_weekday("someday")

    def test_mask_of_names(self):
        self.assertEqual(weekday_mask(["monday", "friday"]), 0b0010001)

    def test_mask_of_numbers(self):
        self.assertEqual(weekday_mask([0, 4]), 0b0010001)

    def test_mask_of_mixed_forms(self):
        self.assertEqual(weekday_mask(["mon", 4]), weekday_mask([0, "friday"]))

    def test_mask_ignores_repeats(self):
        self.assertEqual(weekday_mask(["mon", "mon"]), weekday_mask(["mon"]))

    def test_empty_mask_is_zero(self):
        self.assertEqual(weekday_mask([]), 0)

    def test_mask_rejects_an_out_of_range_number(self):
        with self.assertRaises(ServiceError):
            weekday_mask([7])

    def test_mask_covers_the_right_day(self):
        mask = weekday_mask(["wednesday"])
        self.assertTrue(mask_contains(mask, date(2026, 7, 1)))

    def test_mask_misses_another_day(self):
        mask = weekday_mask(["wednesday"])
        self.assertFalse(mask_contains(mask, date(2026, 7, 2)))

    def test_names_of_a_mask_come_back_in_order(self):
        self.assertEqual(mask_names(weekday_mask(["sun", "mon"])), ("monday", "sunday"))

    def test_names_of_nothing(self):
        self.assertEqual(mask_names(0), ())

    def test_every_weekday_round_trips(self):
        for index, name in enumerate(WEEKDAY_NAMES):
            with self.subTest(name=name):
                self.assertEqual(parse_weekday(name), index)
                self.assertEqual(mask_names(weekday_mask([index])), (name,))

    def test_next_weekday_can_be_today(self):
        self.assertEqual(next_weekday(date(2026, 7, 1), 2), date(2026, 7, 1))

    def test_next_weekday_can_skip_today(self):
        self.assertEqual(next_weekday(date(2026, 7, 1), 2, include_start=False), date(2026, 7, 8))

    def test_next_weekday_wraps_the_week(self):
        self.assertEqual(next_weekday(date(2026, 7, 1), 0), date(2026, 7, 6))

    def test_next_weekday_rejects_an_unknown_day(self):
        with self.assertRaises(ServiceError):
            next_weekday(date(2026, 7, 1), 9)

    def test_days_between_counts_forward(self):
        self.assertEqual(days_between(date(2026, 7, 1), date(2026, 7, 31)), 30)

    def test_days_between_goes_negative(self):
        self.assertEqual(days_between(date(2026, 7, 31), date(2026, 7, 1)), -30)


class DateRangeTest(unittest.TestCase):
    def setUp(self):
        self.july = DateRange(date(2026, 7, 1), date(2026, 7, 31))

    def test_both_ends_count(self):
        self.assertEqual(len(self.july), 31)

    def test_holds_the_last_day(self):
        self.assertIn(date(2026, 7, 31), self.july)

    def test_holds_the_first_day(self):
        self.assertIn(date(2026, 7, 1), self.july)

    def test_excludes_the_day_after(self):
        self.assertNotIn(date(2026, 8, 1), self.july)

    def test_excludes_a_non_date(self):
        self.assertNotIn("2026-07-05", self.july)

    def test_iterates_in_order(self):
        days = list(self.july)
        self.assertEqual(days[0], date(2026, 7, 1))
        self.assertEqual(days[-1], date(2026, 7, 31))
        self.assertEqual(len(days), 31)

    def test_a_single_day_range(self):
        one = DateRange(date(2026, 7, 4), date(2026, 7, 4))
        self.assertEqual(len(one), 1)

    def test_rejects_an_inside_out_range(self):
        with self.assertRaises(ServiceError):
            DateRange(date(2026, 7, 31), date(2026, 7, 1))

    def test_renders_with_two_dots(self):
        self.assertEqual(str(self.july), "2026-07-01..2026-07-31")

    def test_parses_what_it_renders(self):
        self.assertEqual(DateRange.parse(str(self.july)), self.july)

    def test_parse_rejects_a_single_date(self):
        with self.assertRaises(ServiceError):
            DateRange.parse("2026-07-01")

    def test_overlap_is_symmetric(self):
        august = DateRange(date(2026, 7, 15), date(2026, 8, 15))
        self.assertTrue(self.july.overlaps(august))
        self.assertTrue(august.overlaps(self.july))

    def test_a_range_that_misses(self):
        later = DateRange(date(2026, 8, 1), date(2026, 8, 31))
        self.assertFalse(self.july.overlaps(later))

    def test_clip_returns_the_shared_span(self):
        august = DateRange(date(2026, 7, 15), date(2026, 8, 15))
        self.assertEqual(self.july.clip(august), DateRange(date(2026, 7, 15), date(2026, 7, 31)))

    def test_clip_of_a_miss_is_nothing(self):
        later = DateRange(date(2026, 8, 1), date(2026, 8, 31))
        self.assertIsNone(self.july.clip(later))

    def test_widen_stretches_both_ends(self):
        wider = self.july.widen(1, 2)
        self.assertEqual(wider.start, date(2026, 6, 30))
        self.assertEqual(wider.end, date(2026, 8, 2))

    def test_weekdays_picks_the_right_dates(self):
        mondays = self.july.weekdays(weekday_mask(["monday"]))
        self.assertEqual(mondays[0], date(2026, 7, 6))
        self.assertEqual(len(mondays), 4)

    def test_weekdays_of_an_empty_mask(self):
        self.assertEqual(self.july.weekdays(0), ())

    def test_weekdays_of_a_full_mask(self):
        full = weekday_mask(range(7))
        self.assertEqual(len(self.july.weekdays(full)), 31)

    def test_month_range_of_july(self):
        self.assertEqual(DateRange.of_month(2026, 7), self.july)

    def test_month_range_of_december(self):
        self.assertEqual(DateRange.of_month(2026, 12).end, date(2026, 12, 31))

    def test_month_range_of_a_leap_february(self):
        self.assertEqual(len(DateRange.of_month(2028, 2)), 29)

    def test_month_range_rejects_a_bad_month(self):
        with self.assertRaises(ServiceError):
            DateRange.of_month(2026, 13)

    def test_around_a_date(self):
        window = DateRange.around(date(2026, 7, 15), before=1, after=1)
        self.assertEqual(len(window), 3)

    def test_around_with_no_padding_is_one_day(self):
        self.assertEqual(len(DateRange.around(date(2026, 7, 15))), 1)

    def test_ranges_order_by_start(self):
        self.assertLess(DateRange.of_month(2026, 6), self.july)


if __name__ == "__main__":
    unittest.main()
