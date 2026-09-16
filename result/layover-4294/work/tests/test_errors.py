"""Error codes and the places they point at."""

import unittest

from layover.errors import (
    CliError,
    DocumentError,
    FareError,
    FeedError,
    LayoverError,
    Location,
    NetworkError,
    PlanError,
    ServiceError,
    TimeFormatError,
    code_of,
    describe,
    known_codes,
)

CLASSES = (
    LayoverError,
    TimeFormatError,
    ServiceError,
    NetworkError,
    FeedError,
    PlanError,
    FareError,
    DocumentError,
    CliError,
)


class LocationTest(unittest.TestCase):
    def test_renders_a_table_alone(self):
        self.assertEqual(str(Location("stops")), "stops")

    def test_renders_a_row(self):
        self.assertEqual(str(Location("stops", 4)), "stops row 4")

    def test_renders_a_field(self):
        self.assertEqual(str(Location("stops", 4, "lat")), "stops row 4 field 'lat'")

    def test_renders_a_field_with_no_row(self):
        self.assertEqual(str(Location("stops", None, "lat")), "stops field 'lat'")

    def test_pointing_at_a_field_keeps_the_row(self):
        where = Location("stops", 4).with_field("lat")
        self.assertEqual((where.table, where.row, where.field), ("stops", 4, "lat"))

    def test_is_hashable(self):
        self.assertEqual(len({Location("a", 1), Location("a", 1)}), 1)

    def test_orders_by_table_then_row(self):
        self.assertLess(Location("a", 2), Location("b", 1))

    def test_orders_by_row_within_a_table(self):
        self.assertLess(Location("a", 1), Location("a", 2))


class ErrorTest(unittest.TestCase):
    def test_every_class_is_a_layover_error(self):
        for cls in CLASSES:
            with self.subTest(cls=cls.__name__):
                self.assertTrue(issubclass(cls, LayoverError))

    def test_every_class_has_a_code(self):
        for cls in CLASSES:
            with self.subTest(cls=cls.__name__):
                self.assertIsInstance(cls.code, str)
                self.assertTrue(cls.code)

    def test_codes_are_distinct(self):
        codes = [cls.code for cls in CLASSES]
        self.assertEqual(len(codes), len(set(codes)))

    def test_known_codes_lists_them_all(self):
        self.assertEqual(known_codes(), tuple(sorted(cls.code for cls in CLASSES)))

    def test_known_codes_are_sorted(self):
        self.assertEqual(list(known_codes()), sorted(known_codes()))

    def test_message_is_kept(self):
        self.assertEqual(FeedError("no such stop").message, "no such stop")

    def test_string_without_a_place_is_the_message(self):
        self.assertEqual(str(FeedError("no such stop")), "no such stop")

    def test_string_with_a_place_names_it(self):
        error = FeedError("no such stop", Location("trips", 2, "stop_id"))
        self.assertEqual(str(error), "no such stop (trips row 2 field 'stop_id')")

    def test_place_defaults_to_nothing(self):
        self.assertIsNone(FeedError("bare").where)

    def test_code_of_an_error(self):
        self.assertEqual(code_of(PlanError("nope")), "plan")

    def test_code_of_a_stranger(self):
        self.assertEqual(code_of(ValueError("nope")), "unknown")

    def test_describe_leads_with_the_code(self):
        self.assertEqual(describe(FareError("no rule")), "fare: no rule")

    def test_describe_includes_the_place(self):
        text = describe(FeedError("bad", Location("stops", 1)))
        self.assertEqual(text, "feed: bad (stops row 1)")

    def test_errors_can_be_caught_as_the_base(self):
        for cls in CLASSES:
            with self.subTest(cls=cls.__name__):
                with self.assertRaises(LayoverError):
                    raise cls("boom")

    def test_errors_are_exceptions(self):
        self.assertIsInstance(CliError("boom"), Exception)


if __name__ == "__main__":
    unittest.main()
