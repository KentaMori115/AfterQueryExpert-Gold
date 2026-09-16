"""Routes, modes and agencies."""

import unittest

from layover.errors import NetworkError
from layover.network.routes import Agency, Mode, Route


class ModeTest(unittest.TestCase):
    def test_reads_a_name(self):
        self.assertIs(Mode.parse("metro"), Mode.METRO)

    def test_reads_a_feed_number(self):
        self.assertIs(Mode.parse("3"), Mode.BUS)

    def test_reads_a_number_for_every_common_mode(self):
        for number, name in (("0", "tram"), ("1", "metro"), ("2", "rail"), ("4", "ferry")):
            with self.subTest(number=number):
                self.assertEqual(Mode.parse(number).value, name)

    def test_ignores_case(self):
        self.assertIs(Mode.parse("FERRY"), Mode.FERRY)

    def test_passes_a_mode_through(self):
        self.assertIs(Mode.parse(Mode.TRAM), Mode.TRAM)

    def test_rejects_nonsense(self):
        with self.assertRaises(NetworkError):
            Mode.parse("hovercraft")

    def test_rail_modes_run_on_rails(self):
        for mode in (Mode.TRAM, Mode.METRO, Mode.RAIL, Mode.FUNICULAR):
            with self.subTest(mode=mode):
                self.assertTrue(mode.on_rails)

    def test_road_and_water_modes_do_not(self):
        for mode in (Mode.BUS, Mode.FERRY, Mode.CABLE, Mode.GONDOLA):
            with self.subTest(mode=mode):
                self.assertFalse(mode.on_rails)

    def test_renders_as_its_name(self):
        self.assertEqual(str(Mode.BUS), "bus")


class AgencyTest(unittest.TestCase):
    def test_keeps_its_name(self):
        self.assertEqual(Agency("bvg", "BVG").name, "BVG")

    def test_rejects_an_empty_identifier(self):
        with self.assertRaises(NetworkError):
            Agency(" ", "BVG")

    def test_rejects_an_empty_name(self):
        with self.assertRaises(NetworkError):
            Agency("bvg", "  ")

    def test_a_timezone_is_recorded_as_written(self):
        self.assertEqual(Agency("bvg", "BVG", timezone="Europe/Berlin").timezone, "Europe/Berlin")

    def test_renders_as_its_name(self):
        self.assertEqual(str(Agency("bvg", "BVG")), "BVG")


class RouteTest(unittest.TestCase):
    def setUp(self):
        self.route = Route("u2", "U2", "Ruhleben to Pankow", "metro", "bvg", "#F2A900")

    def test_keeps_the_short_name(self):
        self.assertEqual(self.route.short_name, "U2")

    def test_defaults_to_a_bus(self):
        self.assertIs(Route("100", "100").mode, Mode.BUS)

    def test_rejects_an_empty_identifier(self):
        with self.assertRaises(NetworkError):
            Route("  ", "U2")

    def test_rejects_a_route_with_no_name_at_all(self):
        with self.assertRaises(NetworkError):
            Route("u2", "  ", "  ")

    def test_a_long_name_alone_is_enough(self):
        self.assertEqual(Route("u2", "", "Ruhleben to Pankow").name, "Ruhleben to Pankow")

    def test_the_name_prefers_the_short_one(self):
        self.assertEqual(self.route.name, "U2")

    def test_the_full_name_has_both(self):
        self.assertEqual(self.route.full_name, "U2 Ruhleben to Pankow")

    def test_the_full_name_of_a_short_only_route(self):
        self.assertEqual(Route("100", "100").full_name, "100")

    def test_a_colour_loses_its_hash(self):
        self.assertEqual(self.route.colour, "F2A900")

    def test_a_colour_is_upper_cased(self):
        self.assertEqual(Route("u2", "U2", colour="f2a900").colour, "F2A900")

    def test_a_short_colour_is_refused(self):
        with self.assertRaises(NetworkError):
            Route("u2", "U2", colour="F2A")

    def test_a_colour_with_a_stray_letter_is_refused(self):
        with self.assertRaises(NetworkError):
            Route("u2", "U2", colour="GGGGGG")

    def test_no_colour_is_fine(self):
        self.assertIsNone(Route("u2", "U2").colour)

    def test_renders_mode_and_name(self):
        self.assertEqual(str(self.route), "metro U2")

    def test_is_hashable(self):
        self.assertEqual(len({Route("u2", "U2"), Route("u2", "U2")}), 1)


if __name__ == "__main__":
    unittest.main()
