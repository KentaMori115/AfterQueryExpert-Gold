"""Clock times, durations and windows on a service day."""

import unittest

from layover.errors import Location, TimeFormatError
from layover.times import (
    SECONDS_PER_DAY,
    SECONDS_PER_HOUR,
    SECONDS_PER_MINUTE,
    TimeWindow,
    day_offset,
    format_clock,
    format_duration,
    format_short,
    is_valid_clock,
    parse_clock,
    parse_duration,
    round_to_minute,
    shift_days,
    sorted_times,
)


class ParseClockTest(unittest.TestCase):
    def test_reads_hours_minutes_seconds(self):
        self.assertEqual(parse_clock("07:05:09"), 7 * 3600 + 5 * 60 + 9)

    def test_reads_hours_and_minutes(self):
        self.assertEqual(parse_clock("07:05"), 7 * 3600 + 5 * 60)

    def test_midnight_is_zero(self):
        self.assertEqual(parse_clock("00:00:00"), 0)

    def test_keeps_hours_past_midnight(self):
        self.assertEqual(parse_clock("25:10:00"), 25 * 3600 + 600)

    def test_orders_after_the_late_evening(self):
        self.assertGreater(parse_clock("25:10"), parse_clock("23:50"))

    def test_accepts_a_single_leading_digit(self):
        self.assertEqual(parse_clock("7:05"), parse_clock("07:05"))

    def test_tolerates_surrounding_space(self):
        self.assertEqual(parse_clock("  7:05 "), parse_clock("07:05"))

    def test_tolerates_space_inside(self):
        self.assertEqual(parse_clock(" 7: 5"), parse_clock("07:05"))

    def test_rejects_empty(self):
        with self.assertRaises(TimeFormatError):
            parse_clock("")

    def test_rejects_blank(self):
        with self.assertRaises(TimeFormatError):
            parse_clock("   ")

    def test_rejects_one_part(self):
        with self.assertRaises(TimeFormatError):
            parse_clock("0700")

    def test_rejects_four_parts(self):
        with self.assertRaises(TimeFormatError):
            parse_clock("07:00:00:00")

    def test_rejects_letters(self):
        with self.assertRaises(TimeFormatError):
            parse_clock("seven:00")

    def test_rejects_a_negative_time(self):
        with self.assertRaises(TimeFormatError):
            parse_clock("-1:00")

    def test_rejects_sixty_minutes(self):
        with self.assertRaises(TimeFormatError):
            parse_clock("07:60")

    def test_rejects_sixty_seconds(self):
        with self.assertRaises(TimeFormatError):
            parse_clock("07:00:60")

    def test_rejects_more_than_three_days(self):
        with self.assertRaises(TimeFormatError):
            parse_clock("73:00:00")

    def test_rejects_a_number(self):
        with self.assertRaises(TimeFormatError):
            parse_clock(700)

    def test_carries_the_place_into_the_error(self):
        where = Location("stop_times", 12, "departure")
        with self.assertRaises(TimeFormatError) as caught:
            parse_clock("nope", where)
        self.assertIs(caught.exception.where, where)

    def test_validity_check_agrees(self):
        for text in ("07:05", "25:10:00", " 7:05 "):
            with self.subTest(text=text):
                self.assertTrue(is_valid_clock(text))

    def test_validity_check_rejects(self):
        for text in ("", "07:60", "nope", "1:2:3:4"):
            with self.subTest(text=text):
                self.assertFalse(is_valid_clock(text))


class FormatClockTest(unittest.TestCase):
    def test_pads_every_field(self):
        self.assertEqual(format_clock(3661), "01:01:01")

    def test_keeps_hours_past_a_day(self):
        self.assertEqual(format_clock(90600), "25:10:00")

    def test_zero_is_midnight(self):
        self.assertEqual(format_clock(0), "00:00:00")

    def test_rejects_a_negative_time(self):
        with self.assertRaises(TimeFormatError):
            format_clock(-1)

    def test_round_trips_every_minute_of_a_day(self):
        for seconds in range(0, SECONDS_PER_DAY, 617):
            with self.subTest(seconds=seconds):
                self.assertEqual(parse_clock(format_clock(seconds)), seconds)

    def test_short_form_drops_seconds(self):
        self.assertEqual(format_short(3661), "01:01")

    def test_short_form_keeps_late_hours(self):
        self.assertEqual(format_short(90600), "25:10")

    def test_short_form_rejects_a_negative_time(self):
        with self.assertRaises(TimeFormatError):
            format_short(-5)


class DurationTest(unittest.TestCase):
    def test_a_bare_number_is_minutes(self):
        self.assertEqual(parse_duration("90"), 90 * 60)

    def test_reads_minutes(self):
        self.assertEqual(parse_duration("5m"), 300)

    def test_reads_hours_and_minutes(self):
        self.assertEqual(parse_duration("1h30m"), 5400)

    def test_reads_minutes_and_seconds(self):
        self.assertEqual(parse_duration("2m15s"), 135)

    def test_reads_all_three(self):
        self.assertEqual(parse_duration("1h2m3s"), 3723)

    def test_ignores_spacing_and_case(self):
        self.assertEqual(parse_duration(" 1H 30M "), 5400)

    def test_rejects_an_unknown_unit(self):
        with self.assertRaises(TimeFormatError):
            parse_duration("5d")

    def test_rejects_a_repeated_unit(self):
        with self.assertRaises(TimeFormatError):
            parse_duration("1m1m")

    def test_rejects_a_unit_with_no_number(self):
        with self.assertRaises(TimeFormatError):
            parse_duration("hm")

    def test_rejects_a_trailing_number(self):
        with self.assertRaises(TimeFormatError):
            parse_duration("1h30")

    def test_rejects_empty(self):
        with self.assertRaises(TimeFormatError):
            parse_duration("  ")

    def test_rejects_a_number(self):
        with self.assertRaises(TimeFormatError):
            parse_duration(90)

    def test_formats_hours_and_minutes(self):
        self.assertEqual(format_duration(5400), "1h30m")

    def test_formats_minutes_alone(self):
        self.assertEqual(format_duration(2700), "45m")

    def test_formats_seconds_alone(self):
        self.assertEqual(format_duration(30), "30s")

    def test_formats_nothing_as_zero_minutes(self):
        self.assertEqual(format_duration(0), "0m")

    def test_formats_a_whole_hour(self):
        self.assertEqual(format_duration(3600), "1h")

    def test_rejects_formatting_a_negative(self):
        with self.assertRaises(TimeFormatError):
            format_duration(-1)

    def test_round_trips_a_spread_of_lengths(self):
        for seconds in (1, 59, 60, 61, 3599, 3600, 3601, 86399):
            with self.subTest(seconds=seconds):
                self.assertEqual(parse_duration(format_duration(seconds)), seconds)


class ArithmeticTest(unittest.TestCase):
    def test_day_offset_splits_a_late_time(self):
        self.assertEqual(day_offset(90600), (1, 4200))

    def test_day_offset_of_an_ordinary_time(self):
        self.assertEqual(day_offset(4200), (0, 4200))

    def test_shift_moves_a_whole_day(self):
        self.assertEqual(shift_days(3600, 1), 3600 + SECONDS_PER_DAY)

    def test_shift_can_go_back(self):
        self.assertEqual(shift_days(SECONDS_PER_DAY + 60, -1), 60)

    def test_shift_refuses_to_go_before_the_day(self):
        with self.assertRaises(TimeFormatError):
            shift_days(60, -1)

    def test_rounding_goes_down_below_half(self):
        self.assertEqual(round_to_minute(89), 60)

    def test_rounding_goes_up_on_the_half(self):
        self.assertEqual(round_to_minute(90), 120)

    def test_rounding_leaves_a_whole_minute(self):
        self.assertEqual(round_to_minute(120), 120)

    def test_sorted_times_orders_and_freezes(self):
        self.assertEqual(sorted_times([90600, 60, 3600]), (60, 3600, 90600))

    def test_constants_agree(self):
        self.assertEqual(SECONDS_PER_HOUR, 60 * SECONDS_PER_MINUTE)
        self.assertEqual(SECONDS_PER_DAY, 24 * SECONDS_PER_HOUR)


class TimeWindowTest(unittest.TestCase):
    def setUp(self):
        self.morning = TimeWindow(parse_clock("07:00"), parse_clock("09:30"))

    def test_length_is_the_span(self):
        self.assertEqual(self.morning.length, 9000)

    def test_contains_the_start(self):
        self.assertTrue(self.morning.contains(parse_clock("07:00")))

    def test_excludes_the_end(self):
        self.assertFalse(self.morning.contains(parse_clock("09:30")))

    def test_excludes_before_the_start(self):
        self.assertFalse(self.morning.contains(parse_clock("06:59")))

    def test_an_equal_window_is_empty(self):
        self.assertTrue(TimeWindow(100, 100).empty)

    def test_an_empty_window_contains_nothing(self):
        self.assertFalse(TimeWindow(100, 100).contains(100))

    def test_rejects_an_inside_out_window(self):
        with self.assertRaises(TimeFormatError):
            TimeWindow(200, 100)

    def test_overlap_is_symmetric(self):
        other = TimeWindow(parse_clock("09:00"), parse_clock("10:00"))
        self.assertTrue(self.morning.overlaps(other))
        self.assertTrue(other.overlaps(self.morning))

    def test_touching_windows_do_not_overlap(self):
        other = TimeWindow(parse_clock("09:30"), parse_clock("10:00"))
        self.assertFalse(self.morning.overlaps(other))

    def test_clip_returns_the_shared_part(self):
        other = TimeWindow(parse_clock("09:00"), parse_clock("10:00"))
        self.assertEqual(self.morning.clip(other), TimeWindow(parse_clock("09:00"), parse_clock("09:30")))

    def test_clip_of_a_miss_is_empty(self):
        other = TimeWindow(parse_clock("10:00"), parse_clock("11:00"))
        self.assertTrue(self.morning.clip(other).empty)

    def test_widen_stretches_both_ends(self):
        wider = self.morning.widen(600, 900)
        self.assertEqual(wider.start, self.morning.start - 600)
        self.assertEqual(wider.end, self.morning.end + 900)

    def test_widen_stops_at_the_start_of_the_day(self):
        self.assertEqual(TimeWindow(60, 120).widen(600).start, 0)

    def test_shift_moves_both_ends(self):
        moved = self.morning.shift(3600)
        self.assertEqual(moved.length, self.morning.length)
        self.assertEqual(moved.start, self.morning.start + 3600)

    def test_minutes_walks_the_window(self):
        window = TimeWindow(0, 180)
        self.assertEqual(list(window.minutes()), [0, 60, 120])

    def test_minutes_takes_a_step(self):
        window = TimeWindow(0, 180)
        self.assertEqual(list(window.minutes(90)), [0, 90])

    def test_minutes_refuses_a_still_step(self):
        with self.assertRaises(TimeFormatError):
            list(TimeWindow(0, 60).minutes(0))

    def test_day_window_covers_a_whole_day(self):
        self.assertEqual(TimeWindow.of_day(0), TimeWindow(0, SECONDS_PER_DAY))

    def test_day_window_of_the_second_day(self):
        self.assertEqual(TimeWindow.of_day(1).start, SECONDS_PER_DAY)

    def test_parses_a_written_window(self):
        self.assertEqual(TimeWindow.parse("07:00-09:30"), self.morning)

    def test_rejects_a_window_with_no_dash(self):
        with self.assertRaises(TimeFormatError):
            TimeWindow.parse("07:00")

    def test_renders_short(self):
        self.assertEqual(str(self.morning), "07:00-09:30")

    def test_windows_order_by_start(self):
        early = TimeWindow(0, 100)
        self.assertLess(early, self.morning)


if __name__ == "__main__":
    unittest.main()
