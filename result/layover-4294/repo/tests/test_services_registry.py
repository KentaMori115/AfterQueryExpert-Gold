"""The registry of service calendars and its date index."""

import unittest
from datetime import date

from layover.dates import DateRange
from layover.errors import ServiceError
from layover.services.calendar import ServiceCalendar
from layover.services.registry import ServiceRegistry

JULY = DateRange(date(2026, 7, 1), date(2026, 7, 31))


def registry():
    return ServiceRegistry(
        [
            ServiceCalendar.weekly("weekday", ["mon", "tue", "wed", "thu", "fri"], JULY),
            ServiceCalendar.weekly("weekend", ["sat", "sun"], JULY),
            ServiceCalendar.on_dates("holiday", [date(2026, 7, 14)]),
        ]
    )


class HoldingTest(unittest.TestCase):
    def setUp(self):
        self.registry = registry()

    def test_counts_its_services(self):
        self.assertEqual(len(self.registry), 3)

    def test_identifiers_come_back_sorted(self):
        self.assertEqual(self.registry.ids(), ("holiday", "weekday", "weekend"))

    def test_iterates_in_identifier_order(self):
        self.assertEqual([c.service_id for c in self.registry], list(self.registry.ids()))

    def test_membership(self):
        self.assertIn("weekday", self.registry)
        self.assertNotIn("nightbus", self.registry)

    def test_get_returns_the_calendar(self):
        self.assertEqual(self.registry.get("weekday").service_id, "weekday")

    def test_get_raises_on_an_unknown_service(self):
        with self.assertRaises(ServiceError):
            self.registry.get("nightbus")

    def test_find_returns_nothing_on_an_unknown_service(self):
        self.assertIsNone(self.registry.find("nightbus"))

    def test_rejects_a_repeated_identifier(self):
        with self.assertRaises(ServiceError):
            self.registry.add(ServiceCalendar.on_dates("weekday", [date(2026, 7, 1)]))

    def test_rejects_something_that_is_not_a_calendar(self):
        with self.assertRaises(ServiceError):
            self.registry.add("weekday")

    def test_an_empty_registry(self):
        self.assertEqual(len(ServiceRegistry()), 0)

    def test_renders_a_count(self):
        self.assertEqual(str(self.registry), "3 services")


class DateIndexTest(unittest.TestCase):
    def setUp(self):
        self.registry = registry()

    def test_a_weekday_runs_the_weekday_service(self):
        self.assertEqual(self.registry.active_on(date(2026, 7, 1)), ("weekday",))

    def test_a_saturday_runs_the_weekend_service(self):
        self.assertEqual(self.registry.active_on(date(2026, 7, 4)), ("weekend",))

    def test_the_holiday_runs_alongside(self):
        self.assertEqual(self.registry.active_on(date(2026, 7, 14)), ("holiday", "weekday"))

    def test_a_date_outside_runs_nothing(self):
        self.assertEqual(self.registry.active_on(date(2026, 6, 1)), ())

    def test_the_answer_is_cached_and_stable(self):
        first = self.registry.active_on(date(2026, 7, 1))
        self.assertEqual(first, self.registry.active_on(date(2026, 7, 1)))

    def test_adding_a_service_clears_the_cache(self):
        self.registry.active_on(date(2026, 7, 1))
        self.registry.add(ServiceCalendar.on_dates("extra", [date(2026, 7, 1)]))
        self.assertIn("extra", self.registry.active_on(date(2026, 7, 1)))

    def test_runs_on_asks_one_service(self):
        self.assertTrue(self.registry.runs_on("weekend", date(2026, 7, 4)))
        self.assertFalse(self.registry.runs_on("weekend", date(2026, 7, 1)))

    def test_runs_on_raises_for_a_stranger(self):
        with self.assertRaises(ServiceError):
            self.registry.runs_on("nightbus", date(2026, 7, 1))

    def test_dates_covered_spans_the_month(self):
        days = self.registry.dates_covered()
        self.assertEqual(days[0], date(2026, 7, 1))
        self.assertEqual(days[-1], date(2026, 7, 31))
        self.assertEqual(len(days), 31)

    def test_span_is_the_whole_month(self):
        self.assertEqual(self.registry.span(), JULY)

    def test_an_empty_registry_covers_nothing(self):
        self.assertEqual(ServiceRegistry().dates_covered(), ())
        self.assertIsNone(ServiceRegistry().span())

    def test_the_busiest_date_is_the_holiday(self):
        self.assertEqual(self.registry.busiest_date(), date(2026, 7, 14))

    def test_an_empty_registry_has_no_busiest_date(self):
        self.assertIsNone(ServiceRegistry().busiest_date())


class DerivedRegistryTest(unittest.TestCase):
    def setUp(self):
        self.registry = registry()

    def test_subset_keeps_what_is_named(self):
        smaller = self.registry.subset(["weekday"])
        self.assertEqual(smaller.ids(), ("weekday",))

    def test_subset_of_an_unknown_service_raises(self):
        with self.assertRaises(ServiceError):
            self.registry.subset(["nightbus"])

    def test_subset_ignores_repeats(self):
        self.assertEqual(len(self.registry.subset(["weekday", "weekday"])), 1)

    def test_clipping_keeps_the_services_that_still_run(self):
        window = DateRange(date(2026, 7, 4), date(2026, 7, 5))
        clipped = self.registry.clipped(window)
        self.assertEqual(clipped.ids(), ("weekend",))

    def test_clipping_narrows_the_dates(self):
        window = DateRange(date(2026, 7, 6), date(2026, 7, 10))
        clipped = self.registry.clipped(window)
        self.assertEqual(clipped.get("weekday").count(), 5)

    def test_merging_puts_two_registries_together(self):
        other = ServiceRegistry([ServiceCalendar.on_dates("night", [date(2026, 7, 2)])])
        merged = self.registry.merge(other)
        self.assertEqual(len(merged), 4)

    def test_merging_a_clash_raises(self):
        other = ServiceRegistry([ServiceCalendar.on_dates("weekday", [date(2026, 7, 2)])])
        with self.assertRaises(ServiceError):
            self.registry.merge(other)

    def test_merging_leaves_the_originals_alone(self):
        other = ServiceRegistry([ServiceCalendar.on_dates("night", [date(2026, 7, 2)])])
        self.registry.merge(other)
        self.assertEqual(len(self.registry), 3)

    def test_no_service_is_empty_here(self):
        self.assertEqual(self.registry.empty_services(), ())

    def test_an_emptied_service_is_reported(self):
        calendar = ServiceCalendar.weekly("thin", ["mon"], JULY)
        drained = calendar.with_removed(calendar.active_dates())
        self.registry.add(drained)
        self.assertEqual(self.registry.empty_services(), ("thin",))

    def test_duplicates_are_found(self):
        self.registry.add(ServiceCalendar.on_dates("holiday2", [date(2026, 7, 14)]))
        self.assertEqual(self.registry.duplicates(), (("holiday", "holiday2"),))

    def test_no_duplicates_by_default(self):
        self.assertEqual(self.registry.duplicates(), ())


if __name__ == "__main__":
    unittest.main()
